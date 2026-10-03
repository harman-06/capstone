BEGIN;
-- Frontend/API views. These stabilize Harman's UI while allowing DB internals to evolve.

-- Find department ancestor for every asset and calculate frontend quantity/status.
CREATE OR REPLACE VIEW frontend_equipment_inventory_v WITH (security_invoker = true) AS
WITH asset_departments AS (
    SELECT
        a.asset_id,
        a.model_id,
        a.asset_status,
        nh_department_for_location(a.current_location_id) AS department_id
    FROM equipment_assets a
    WHERE a.asset_status NOT IN ('retired','lost')
),
summary AS (
    SELECT
        ad.department_id,
        em.category_id,
        COUNT(*) FILTER (WHERE ad.asset_status = 'available')::INTEGER AS available_qty,
        COUNT(*)::INTEGER AS total_qty
    FROM asset_departments ad
    JOIN equipment_models em ON em.model_id = ad.model_id
    GROUP BY ad.department_id, em.category_id
)
SELECT
    'EQ-' || s.department_id::text || '-' || s.category_id::text AS id,
    ec.name AS name,
    'equipment'::text AS type,
    d.name AS unit,
    s.available_qty AS qty,
    CASE
        WHEN s.available_qty = 0 THEN 'out'
        WHEN s.available_qty <= COALESCE(t.low_threshold,1) THEN 'low'
        ELSE 'available'
    END AS status
FROM (
    SELECT t.department_id, t.category_id, COALESCE(s.available_qty,0) AS available_qty
    FROM inventory_thresholds t
    LEFT JOIN summary s USING (department_id, category_id)
    UNION ALL
    SELECT s.department_id, s.category_id, s.available_qty FROM summary s
    WHERE NOT EXISTS (SELECT 1 FROM inventory_thresholds t
      WHERE t.department_id=s.department_id AND t.category_id=s.category_id)
) s
JOIN equipment_categories ec ON ec.category_id = s.category_id
JOIN locations d ON d.location_id = s.department_id
LEFT JOIN inventory_thresholds t
    ON t.department_id = s.department_id
   AND t.category_id = s.category_id;

CREATE OR REPLACE VIEW frontend_units_v WITH (security_invoker = true) AS
SELECT
    code AS id,
    code AS number,
    name,
    floor
FROM locations
WHERE location_type='department'
  AND is_active=TRUE;

CREATE OR REPLACE VIEW equipment_asset_detail_v WITH (security_invoker = true) AS
SELECT
    a.asset_id,
    a.asset_tag,
    ec.name AS category,
    em.manufacturer,
    em.model_name,
    a.serial_number,
    a.asset_status,
    loc.name AS current_location,
    dept.name AS department,
    a.qr_code_value,
    a.updated_at
FROM equipment_assets a
JOIN equipment_models em ON em.model_id=a.model_id
JOIN equipment_categories ec ON ec.category_id=em.category_id
JOIN locations loc ON loc.location_id=a.current_location_id
LEFT JOIN locations dept ON dept.location_id=nh_department_for_location(a.current_location_id);

CREATE OR REPLACE VIEW pending_transfer_v WITH (security_invoker = true) AS
SELECT
    tr.transfer_id,
    a.asset_tag,
    ec.name AS equipment_type,
    src.name AS from_department,
    dst.name AS to_department,
    u.display_name AS requested_by,
    tr.request_reason,
    tr.transfer_status,
    tr.requested_at
FROM transfer_requests tr
JOIN equipment_assets a ON a.asset_id=tr.asset_id
JOIN equipment_models em ON em.model_id=a.model_id
JOIN equipment_categories ec ON ec.category_id=em.category_id
JOIN locations src ON src.location_id=tr.from_department_id
JOIN locations dst ON dst.location_id=tr.to_department_id
JOIN users u ON u.user_id=tr.requested_by
WHERE tr.transfer_status IN ('requested','reserved','in_transit');

COMMIT;
