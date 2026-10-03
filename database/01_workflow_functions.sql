BEGIN;
-- No browser writes: workflow functions use caller permissions and are SQL-editor only.
-- Reject location cycles and invalid hierarchy edges.
CREATE OR REPLACE FUNCTION nh_validate_location() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE parent_type text;
BEGIN
 IF NEW.location_type='hospital' AND NEW.parent_location_id IS NOT NULL THEN
  RAISE EXCEPTION 'Hospital must be a root location';
 END IF;
 IF NEW.location_type<>'hospital' AND NEW.parent_location_id IS NULL THEN
  RAISE EXCEPTION 'Non-hospital location needs a parent';
 END IF;
 IF NEW.parent_location_id IS NOT NULL THEN
  SELECT location_type INTO parent_type FROM locations WHERE location_id=NEW.parent_location_id;
  IF (NEW.location_type='department' AND parent_type<>'hospital') OR
     (NEW.location_type='room' AND parent_type<>'department') OR
     (NEW.location_type='storage' AND parent_type NOT IN ('department','room')) THEN
   RAISE EXCEPTION 'Invalid location hierarchy';
  END IF;
  IF EXISTS (WITH RECURSIVE chain AS (
    SELECT location_id,parent_location_id FROM locations WHERE location_id=NEW.parent_location_id
    UNION SELECT l.location_id,l.parent_location_id FROM locations l JOIN chain c ON l.location_id=c.parent_location_id
   ) SELECT 1 FROM chain WHERE location_id=NEW.location_id) THEN
   RAISE EXCEPTION 'Location cycle is not allowed';
  END IF;
 END IF;
 -- Reparenting with children could break their hierarchy; type changes need a reviewed migration.
 IF TG_OP='UPDATE' AND NEW.location_type<>OLD.location_type AND EXISTS (
   SELECT 1 FROM locations WHERE parent_location_id=OLD.location_id) THEN
  RAISE EXCEPTION 'Cannot change type of a location with children';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER validate_location BEFORE INSERT OR UPDATE ON locations
FOR EACH ROW EXECUTE FUNCTION nh_validate_location();

CREATE OR REPLACE FUNCTION nh_department_for_location(p_location_id uuid) RETURNS uuid
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
 WITH RECURSIVE chain AS (
  SELECT location_id,parent_location_id,location_type FROM locations WHERE location_id=p_location_id
  UNION SELECT l.location_id,l.parent_location_id,l.location_type FROM locations l JOIN chain c ON l.location_id=c.parent_location_id
 ) SELECT location_id FROM chain WHERE location_type='department' LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION nh_has_scoped_role(p_user uuid, p_department uuid, p_role text) RETURNS boolean
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
 SELECT EXISTS (
  SELECT 1 FROM users u JOIN user_role_assignments a USING(user_id) JOIN roles r USING(role_id)
  JOIN locations d ON d.location_id=p_department
  WHERE u.user_id=p_user AND u.is_active AND r.role_key=p_role
   AND (a.scope_location_id=d.location_id OR a.scope_location_id=d.parent_location_id)
 );
$$;

CREATE OR REPLACE FUNCTION nh_log_transfer_event(p_transfer_id uuid,p_event_type varchar,p_user_id uuid,p_note text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
 INSERT INTO transfer_events(transfer_id,event_type,performed_by,note)
 VALUES(p_transfer_id,p_event_type,p_user_id,p_note);
 INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id,details)
 VALUES(p_user_id,'transfer.'||p_event_type,'transfer',p_transfer_id,jsonb_build_object('note',p_note));
END $$;

CREATE OR REPLACE FUNCTION nh_assert_approver(p_transfer_id uuid,p_approver uuid) RETURNS void
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE tr transfer_requests%ROWTYPE; cat uuid;
BEGIN
 SELECT * INTO STRICT tr FROM transfer_requests WHERE transfer_id=p_transfer_id;
 IF p_approver IS NULL OR p_approver=tr.requested_by THEN RAISE EXCEPTION 'Requester cannot approve or reject their own transfer'; END IF;
 SELECT m.category_id INTO cat FROM equipment_assets a JOIN equipment_models m USING(model_id) WHERE a.asset_id=tr.asset_id;
 IF NOT EXISTS (
  SELECT 1 FROM approval_policies p JOIN roles r ON r.role_id=p.required_role_id
  WHERE p.source_department_id=tr.from_department_id AND p.is_active
   AND (p.category_id IS NULL OR p.category_id=cat)
   AND nh_has_scoped_role(p_approver,tr.from_department_id,r.role_key)
 ) THEN RAISE EXCEPTION 'Approver has no applicable active approval role'; END IF;
END $$;

CREATE OR REPLACE FUNCTION nh_request_transfer(p_asset uuid,p_to_department uuid,p_requester uuid,p_reason text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE a equipment_assets%ROWTYPE; src uuid; result uuid;
BEGIN
 SELECT * INTO STRICT a FROM equipment_assets WHERE asset_id=p_asset FOR UPDATE;
 src:=nh_department_for_location(a.current_location_id);
 IF a.asset_status<>'available' OR EXISTS(SELECT 1 FROM asset_reservations WHERE asset_id=p_asset AND released_at IS NULL) THEN
  RAISE EXCEPTION 'Asset is not available'; END IF;
 IF src IS NULL OR NOT EXISTS(SELECT 1 FROM locations WHERE location_id=src AND is_active) OR
  NOT EXISTS(SELECT 1 FROM locations WHERE location_id=p_to_department AND location_type='department' AND is_active) OR src=p_to_department THEN
  RAISE EXCEPTION 'Transfer requires distinct active departments'; END IF;
 IF NOT (nh_has_scoped_role(p_requester,p_to_department,'nurse') OR nh_has_scoped_role(p_requester,p_to_department,'chargeNurse') OR
  nh_has_scoped_role(p_requester,p_to_department,'doctor') OR nh_has_scoped_role(p_requester,p_to_department,'operations')) THEN
  RAISE EXCEPTION 'Requester needs an active destination-scoped staff role'; END IF;
 INSERT INTO transfer_requests(asset_id,from_department_id,to_department_id,requested_by,request_reason)
 VALUES(p_asset,src,p_to_department,p_requester,p_reason) RETURNING transfer_id INTO result;
 PERFORM nh_log_transfer_event(result,'requested',p_requester,p_reason);
 RETURN result;
END $$;

CREATE OR REPLACE FUNCTION nh_approve_transfer(p_transfer_id uuid,p_approver uuid,p_note text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE tr transfer_requests%ROWTYPE; a equipment_assets%ROWTYPE;
BEGIN
 SELECT * INTO STRICT tr FROM transfer_requests WHERE transfer_id=p_transfer_id FOR UPDATE;
 IF tr.transfer_status<>'requested' THEN RAISE EXCEPTION 'Only requested transfers may be approved'; END IF;
 PERFORM nh_assert_approver(p_transfer_id,p_approver);
 SELECT * INTO STRICT a FROM equipment_assets WHERE asset_id=tr.asset_id FOR UPDATE;
 IF a.asset_status<>'available' OR nh_department_for_location(a.current_location_id) IS DISTINCT FROM tr.from_department_id THEN
  RAISE EXCEPTION 'Asset is unavailable or has moved'; END IF;
 IF EXISTS(SELECT 1 FROM asset_reservations WHERE asset_id=tr.asset_id AND released_at IS NULL) THEN RAISE EXCEPTION 'Asset already reserved'; END IF;
 INSERT INTO asset_reservations(asset_id,transfer_id) VALUES(tr.asset_id,p_transfer_id);
 UPDATE equipment_assets SET asset_status='reserved',updated_at=now() WHERE asset_id=tr.asset_id;
 UPDATE transfer_requests SET transfer_status='reserved',approved_by=p_approver,decision_note=p_note,decided_at=now() WHERE transfer_id=p_transfer_id;
 PERFORM nh_log_transfer_event(p_transfer_id,'approved',p_approver,p_note);
 PERFORM nh_log_transfer_event(p_transfer_id,'reserved',p_approver,'Asset reserved on approval');
END $$;

CREATE OR REPLACE FUNCTION nh_reject_transfer(p_transfer_id uuid,p_approver uuid,p_note text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE tr transfer_requests%ROWTYPE;
BEGIN
 SELECT * INTO STRICT tr FROM transfer_requests WHERE transfer_id=p_transfer_id FOR UPDATE;
 IF tr.transfer_status<>'requested' THEN RAISE EXCEPTION 'Only requested transfers may be rejected'; END IF;
 PERFORM nh_assert_approver(p_transfer_id,p_approver);
 UPDATE transfer_requests SET transfer_status='rejected',approved_by=p_approver,decision_note=p_note,decided_at=now() WHERE transfer_id=p_transfer_id;
 PERFORM nh_log_transfer_event(p_transfer_id,'rejected',p_approver,p_note);
END $$;

CREATE OR REPLACE FUNCTION nh_assert_operator(p_user uuid,p_from uuid,p_to uuid) RETURNS void
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
 IF NOT (nh_has_scoped_role(p_user,p_from,'operations') OR nh_has_scoped_role(p_user,p_to,'operations') OR
  nh_has_scoped_role(p_user,p_from,'chargeNurse') OR nh_has_scoped_role(p_user,p_to,'chargeNurse')) THEN
  RAISE EXCEPTION 'Operator needs an active operations or charge nurse role'; END IF;
END $$;

CREATE OR REPLACE FUNCTION nh_start_transfer(p_transfer_id uuid,p_user uuid) RETURNS void
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE tr transfer_requests%ROWTYPE;
BEGIN
 SELECT * INTO STRICT tr FROM transfer_requests WHERE transfer_id=p_transfer_id FOR UPDATE;
 IF tr.transfer_status<>'reserved' THEN RAISE EXCEPTION 'Transfer must be reserved before transit'; END IF;
 PERFORM nh_assert_operator(p_user,tr.from_department_id,tr.to_department_id);
 PERFORM 1 FROM equipment_assets WHERE asset_id=tr.asset_id AND asset_status='reserved' FOR UPDATE;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM asset_reservations WHERE transfer_id=p_transfer_id AND released_at IS NULL) THEN
  RAISE EXCEPTION 'Transfer reservation is inconsistent'; END IF;
 UPDATE equipment_assets SET asset_status='in_transit',updated_at=now() WHERE asset_id=tr.asset_id;
 UPDATE transfer_requests SET transfer_status='in_transit' WHERE transfer_id=p_transfer_id;
 PERFORM nh_log_transfer_event(p_transfer_id,'in_transit',p_user,NULL);
END $$;

CREATE OR REPLACE FUNCTION nh_complete_transfer(p_transfer_id uuid,p_user uuid) RETURNS void
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE tr transfer_requests%ROWTYPE;
BEGIN
 SELECT * INTO STRICT tr FROM transfer_requests WHERE transfer_id=p_transfer_id FOR UPDATE;
 IF tr.transfer_status<>'in_transit' THEN RAISE EXCEPTION 'Transfer must be in transit before completion'; END IF;
 PERFORM nh_assert_operator(p_user,tr.from_department_id,tr.to_department_id);
 PERFORM 1 FROM equipment_assets WHERE asset_id=tr.asset_id AND asset_status='in_transit' FOR UPDATE;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM asset_reservations WHERE transfer_id=p_transfer_id AND released_at IS NULL) THEN
  RAISE EXCEPTION 'Transfer reservation is inconsistent'; END IF;
 UPDATE equipment_assets SET current_location_id=tr.to_department_id,asset_status='available',updated_at=now() WHERE asset_id=tr.asset_id;
 UPDATE asset_reservations SET released_at=now() WHERE transfer_id=p_transfer_id AND released_at IS NULL;
 UPDATE transfer_requests SET transfer_status='completed',completed_at=now() WHERE transfer_id=p_transfer_id;
 PERFORM nh_log_transfer_event(p_transfer_id,'completed',p_user,NULL);
END $$;

CREATE OR REPLACE FUNCTION nh_cancel_transfer(p_transfer_id uuid,p_user uuid,p_note text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE tr transfer_requests%ROWTYPE;
BEGIN
 SELECT * INTO STRICT tr FROM transfer_requests WHERE transfer_id=p_transfer_id FOR UPDATE;
 IF tr.transfer_status NOT IN ('requested','reserved') THEN RAISE EXCEPTION 'Only requested or reserved transfers may be cancelled'; END IF;
 IF p_user IS DISTINCT FROM tr.requested_by THEN PERFORM nh_assert_approver(p_transfer_id,p_user); END IF;
 IF NOT EXISTS(SELECT 1 FROM users WHERE user_id=p_user AND is_active) THEN RAISE EXCEPTION 'Inactive actor'; END IF;
 IF tr.transfer_status='reserved' THEN
  PERFORM 1 FROM equipment_assets WHERE asset_id=tr.asset_id AND asset_status='reserved' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Asset state is inconsistent'; END IF;
  UPDATE asset_reservations SET released_at=now() WHERE transfer_id=p_transfer_id AND released_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Active reservation missing'; END IF;
  UPDATE equipment_assets SET asset_status='available',updated_at=now() WHERE asset_id=tr.asset_id;
 END IF;
 UPDATE transfer_requests SET transfer_status='cancelled',decision_note=p_note,decided_at=now() WHERE transfer_id=p_transfer_id;
 PERFORM nh_log_transfer_event(p_transfer_id,'cancelled',p_user,p_note);
END $$;
COMMIT;
