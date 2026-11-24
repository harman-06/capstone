BEGIN;
DO $$ BEGIN
 IF to_regclass('public.locations') IS NOT NULL OR to_regclass('public.equipment_assets') IS NOT NULL THEN
  RAISE EXCEPTION 'Existing Nexora tables found. Stop: use a reviewed migration, never reset or drop data.';
 END IF;
END $$;
-- Nexora Health Lean Database v3.0
-- PostgreSQL / Supabase-compatible
-- Goal: low maintenance, efficient, stable API contract, minimal duplication.
-- Synthetic/demo data only.

-- gen_random_uuid() is built into current PostgreSQL; no extension required.

-- =========================================================
-- 1. LOCATIONS
-- One hierarchy instead of separate hospital/department/room/storage tables.
-- location_type examples: hospital, department, room, storage
-- =========================================================
CREATE TABLE locations (
    location_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    parent_location_id UUID REFERENCES locations(location_id) ON DELETE RESTRICT,
    location_type VARCHAR(20) NOT NULL CHECK (
        location_type IN ('hospital','department','room','storage')
    ),
    code VARCHAR(40) NOT NULL UNIQUE,
    name VARCHAR(140) NOT NULL,
    floor INTEGER,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_locations_parent ON locations(parent_location_id);
CREATE INDEX idx_locations_type ON locations(location_type);

-- =========================================================
-- 2. USERS / ROLES
-- Keep RBAC compact. Users may hold multiple department-scoped roles.
-- =========================================================
CREATE TABLE roles (
    role_id SMALLSERIAL PRIMARY KEY,
    role_key VARCHAR(50) NOT NULL UNIQUE,
    display_name VARCHAR(80) NOT NULL
);

CREATE TABLE users (
    user_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    auth_subject UUID UNIQUE,
    email VARCHAR(254) UNIQUE,
    display_name VARCHAR(120) NOT NULL,
    home_department_id UUID REFERENCES locations(location_id),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE user_role_assignments (
    user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    role_id SMALLINT NOT NULL REFERENCES roles(role_id) ON DELETE RESTRICT,
    scope_location_id UUID NOT NULL REFERENCES locations(location_id) ON DELETE RESTRICT,
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, role_id, scope_location_id)
);

-- =========================================================
-- 3. EQUIPMENT CATALOG
-- Category -> Model -> Asset.
-- Manufacturer is a field on model to avoid an unnecessary lookup table.
-- =========================================================
CREATE TABLE equipment_categories (
    category_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(120) NOT NULL UNIQUE,
    description TEXT
);

CREATE TABLE equipment_models (
    model_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    category_id UUID NOT NULL REFERENCES equipment_categories(category_id) ON DELETE RESTRICT,
    manufacturer VARCHAR(120),
    model_name VARCHAR(120) NOT NULL,
    description TEXT,
    UNIQUE (category_id, manufacturer, model_name)
);

CREATE TABLE equipment_assets (
    asset_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    asset_tag VARCHAR(60) NOT NULL UNIQUE,
    model_id UUID NOT NULL REFERENCES equipment_models(model_id) ON DELETE RESTRICT,
    current_location_id UUID NOT NULL REFERENCES locations(location_id) ON DELETE RESTRICT,
    asset_status VARCHAR(24) NOT NULL CHECK (
        asset_status IN (
            'available','in_use','reserved','in_transit',
            'maintenance','unavailable','retired','lost'
        )
    ),
    serial_number VARCHAR(100),
    qr_code_value VARCHAR(120) UNIQUE,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_assets_location_status
    ON equipment_assets(current_location_id, asset_status);
CREATE INDEX idx_assets_model
    ON equipment_assets(model_id);

-- =========================================================
-- 4. DEPARTMENT THRESHOLDS
-- Low/out are calculated, not stored.
-- =========================================================
CREATE TABLE inventory_thresholds (
    threshold_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    department_id UUID NOT NULL REFERENCES locations(location_id) ON DELETE CASCADE,
    category_id UUID NOT NULL REFERENCES equipment_categories(category_id) ON DELETE CASCADE,
    low_threshold INTEGER NOT NULL DEFAULT 1 CHECK (low_threshold >= 0),
    UNIQUE (department_id, category_id)
);

-- =========================================================
-- 5. APPROVAL POLICIES
-- Configurable by source department + optional category.
-- NULL category means "all categories".
-- =========================================================
CREATE TABLE approval_policies (
    policy_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_department_id UUID NOT NULL REFERENCES locations(location_id) ON DELETE CASCADE,
    category_id UUID REFERENCES equipment_categories(category_id) ON DELETE CASCADE,
    required_role_id SMALLINT NOT NULL REFERENCES roles(role_id) ON DELETE RESTRICT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    UNIQUE NULLS NOT DISTINCT (source_department_id, category_id, required_role_id)
);

-- =========================================================
-- 6. TRANSFERS + RESERVATIONS
-- Request is current state; events are immutable history.
-- Reservation prevents double-allocation.
-- =========================================================
CREATE TABLE transfer_requests (
    transfer_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    asset_id UUID NOT NULL REFERENCES equipment_assets(asset_id) ON DELETE RESTRICT,
    from_department_id UUID NOT NULL REFERENCES locations(location_id) ON DELETE RESTRICT,
    to_department_id UUID NOT NULL REFERENCES locations(location_id) ON DELETE RESTRICT,
    requested_by UUID NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
    approved_by UUID REFERENCES users(user_id) ON DELETE RESTRICT,
    transfer_status VARCHAR(24) NOT NULL DEFAULT 'requested' CHECK (
        transfer_status IN (
            'requested','approved','rejected',
            'reserved','in_transit','completed','cancelled'
        )
    ),
    request_reason TEXT,
    decision_note TEXT,
    requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    decided_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    CHECK (from_department_id <> to_department_id),
    CHECK (approved_by IS NULL OR approved_by <> requested_by)
);

CREATE INDEX idx_transfer_status ON transfer_requests(transfer_status);
CREATE INDEX idx_transfer_asset ON transfer_requests(asset_id);
CREATE INDEX idx_transfer_departments
    ON transfer_requests(from_department_id, to_department_id);

CREATE TABLE asset_reservations (
    reservation_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    asset_id UUID NOT NULL REFERENCES equipment_assets(asset_id) ON DELETE CASCADE,
    transfer_id UUID NOT NULL UNIQUE REFERENCES transfer_requests(transfer_id) ON DELETE CASCADE,
    reserved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    released_at TIMESTAMPTZ
);

-- One active reservation per asset.
CREATE UNIQUE INDEX uq_active_asset_reservation
    ON asset_reservations(asset_id)
    WHERE released_at IS NULL;

CREATE TABLE transfer_events (
    event_id BIGSERIAL PRIMARY KEY,
    transfer_id UUID NOT NULL REFERENCES transfer_requests(transfer_id) ON DELETE CASCADE,
    event_type VARCHAR(24) NOT NULL CHECK (
        event_type IN (
            'requested','approved','rejected','reserved',
            'in_transit','completed','cancelled'
        )
    ),
    performed_by UUID REFERENCES users(user_id) ON DELETE RESTRICT,
    note TEXT,
    event_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_transfer_events_timeline
    ON transfer_events(transfer_id, event_at);

-- =========================================================
-- 7. MAINTENANCE
-- One table: enough detail for a serious prototype without a large subsystem.
-- =========================================================
CREATE TABLE maintenance_records (
    maintenance_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    asset_id UUID NOT NULL REFERENCES equipment_assets(asset_id) ON DELETE CASCADE,
    technician_user_id UUID REFERENCES users(user_id) ON DELETE SET NULL,
    maintenance_type VARCHAR(80),
    description TEXT NOT NULL,
    result TEXT,
    maintenance_status VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (
        maintenance_status IN ('open','in_progress','closed')
    ),
    opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    closed_at TIMESTAMPTZ,
    next_inspection_at TIMESTAMPTZ
);

CREATE INDEX idx_maintenance_asset_status
    ON maintenance_records(asset_id, maintenance_status);

-- =========================================================
-- 8. NOTIFICATIONS
-- Persisted with read state. Keep generation logic thin.
-- =========================================================
CREATE TABLE notifications (
    notification_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    notification_type VARCHAR(40) NOT NULL,
    title VARCHAR(160) NOT NULL,
    message TEXT,
    entity_type VARCHAR(40),
    entity_id UUID,
    is_read BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    read_at TIMESTAMPTZ
);

CREATE INDEX idx_notifications_user_unread
    ON notifications(user_id, is_read, created_at DESC);

-- =========================================================
-- 9. AUDIT LOG
-- One cross-system audit table instead of many duplicate history tables.
-- Transfer events remain separate because they are part of the domain workflow.
-- =========================================================
CREATE TABLE audit_logs (
    audit_id BIGSERIAL PRIMARY KEY,
    actor_user_id UUID REFERENCES users(user_id) ON DELETE SET NULL,
    action VARCHAR(80) NOT NULL,
    entity_type VARCHAR(40) NOT NULL,
    entity_id UUID,
    details JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_entity
    ON audit_logs(entity_type, entity_id, created_at DESC);

-- Default roles aligned with Harman's current frontend plus equipment operations.
INSERT INTO roles (role_key, display_name) VALUES
('doctor','Doctor'),
('chargeNurse','Charge Nurse'),
('nurse','Nurse'),
('admin','IT Admin'),
('patient','Patient'),
('biomedical','Biomedical Staff'),
('operations','Operations Staff')
ON CONFLICT (role_key) DO NOTHING;

COMMIT;
