-- Run with a trusted SQL role after deploying the release migrations.
-- All test rows are synthetic, isolated, and rolled back before results are returned.
BEGIN;
SET LOCAL plpgsql.check_asserts = on;
DO $$
DECLARE
 owner_role text:=current_user;
 prefix text:='NH-TEST-'||substr(gen_random_uuid()::text,1,8);
 tag text:=prefix||'-A'; h uuid; src uuid; dst uuid; category uuid; model uuid;
 nurse uuid; approver uuid; source_operator uuid; receiver uuid;
 nurse_auth uuid:=gen_random_uuid(); approver_auth uuid:=gen_random_uuid();
 source_auth uuid:=gen_random_uuid(); receiver_auth uuid:=gen_random_uuid();
 supplier_auth uuid:=gen_random_uuid(); other_auth uuid:=gen_random_uuid();
 supplier uuid; other_supplier uuid; need uuid; transfer uuid; enquiry uuid;
 request_key uuid:=gen_random_uuid(); allocation_key uuid:=gen_random_uuid();
 due timestamptz:=statement_timestamp()+interval '1 hour';
 source_item text; destination_item text; payload jsonb; history jsonb; denied boolean;
BEGIN
 SELECT model_id,category_id INTO STRICT model,category FROM public.equipment_models ORDER BY model_id LIMIT 1;
 INSERT INTO public.locations(location_type,code,name)
 VALUES('hospital',prefix,'Synthetic rollback hospital') RETURNING location_id INTO h;
 INSERT INTO public.locations(parent_location_id,location_type,code,name)
 VALUES(h,'department',prefix||'-S','Synthetic source') RETURNING location_id INTO src;
 INSERT INTO public.locations(parent_location_id,location_type,code,name)
 VALUES(h,'department',prefix||'-D','Synthetic destination') RETURNING location_id INTO dst;
 INSERT INTO public.inventory_thresholds(department_id,category_id,low_threshold) VALUES(src,category,1),(dst,category,1);
 INSERT INTO public.equipment_assets(asset_tag,model_id,current_location_id,asset_status)
 VALUES(tag,model,src,'available'),(prefix||'-B',model,src,'available');
 INSERT INTO public.users(auth_subject,email,display_name,home_department_id)
 VALUES(nurse_auth,prefix||'-nurse@example.test','Synthetic nurse',dst) RETURNING user_id INTO nurse;
 INSERT INTO public.users(auth_subject,email,display_name,home_department_id)
 VALUES(approver_auth,prefix||'-approver@example.test','Synthetic approver',src) RETURNING user_id INTO approver;
 INSERT INTO public.users(auth_subject,email,display_name,home_department_id)
 VALUES(source_auth,prefix||'-source@example.test','Synthetic source operator',src) RETURNING user_id INTO source_operator;
 INSERT INTO public.users(auth_subject,email,display_name,home_department_id)
 VALUES(receiver_auth,prefix||'-receiver@example.test','Synthetic receiving operator',dst) RETURNING user_id INTO receiver;
 INSERT INTO public.user_role_assignments(user_id,role_id,scope_location_id)
 SELECT v.actor,r.role_id,v.scope FROM (VALUES
  (nurse,dst,'nurse'),(nurse,src,'chargeNurse'),(approver,h,'chargeNurse'),
  (source_operator,src,'chargeNurse'),(receiver,dst,'chargeNurse')
 ) v(actor,scope,role_key) JOIN public.roles r USING(role_key);
 INSERT INTO public.approval_policies(source_department_id,required_role_id)
 SELECT src,role_id FROM public.roles WHERE role_key='chargeNurse';
 INSERT INTO public.nh_suppliers(hospital_id,name) VALUES(h,prefix||' Supplier A') RETURNING supplier_id INTO supplier;
 INSERT INTO public.nh_suppliers(hospital_id,name) VALUES(h,prefix||' Supplier B') RETURNING supplier_id INTO other_supplier;
 INSERT INTO public.nh_supplier_memberships(auth_subject,supplier_id)
 VALUES(supplier_auth,supplier),(other_auth,other_supplier);
 source_item:='EQ-'||src||'-'||category;
 destination_item:='EQ-'||dst||'-'||category;
 EXECUTE 'SET LOCAL ROLE authenticated';

 PERFORM set_config('request.jwt.claim.sub',nurse_auth::text,true);
 ASSERT (SELECT qty FROM public.frontend_equipment_inventory_v WHERE id=source_item)=2,'Authenticated inventory baseline wrong';
 ASSERT (SELECT qty FROM public.frontend_equipment_inventory_v WHERE id=destination_item)=0,'Destination baseline wrong';
 need:=public.nh_api_submit_equipment_need(source_item,request_key,'Synthetic shortage rehearsal',due);
 ASSERT public.nh_api_submit_equipment_need(source_item,request_key,'Synthetic shortage rehearsal',due)=need,'Request replay changed ID';
 ASSERT jsonb_path_query_array(public.nh_api_request_history('equipment',need),'$[*].stage')='["requested"]'::jsonb,'Initial request history missing';
 denied:=false;
 BEGIN PERFORM public.nh_api_review_allocation(need,3,NULL,'Self review attempt');
 EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
 ASSERT denied,'Self-review was allowed';

 PERFORM set_config('request.jwt.claim.sub',approver_auth::text,true);
 PERFORM public.nh_api_configure_allocation(src,category,1);
 PERFORM public.nh_api_review_allocation(need,2,due,'Synthetic priority reviewed');
 payload:=public.nh_api_allocate_next(src,category,allocation_key);
 ASSERT payload->>'outcome'='allocated','Reviewed request did not allocate';
 transfer:=(payload->>'transfer_id')::uuid;
 ASSERT public.nh_api_allocate_next(src,category,allocation_key)=payload,'Allocation replay changed result';
 ASSERT (SELECT qty FROM public.frontend_equipment_inventory_v WHERE id=source_item)=1,'Source reserve was not maintained';

 PERFORM set_config('request.jwt.claim.sub',source_auth::text,true);
 denied:=false;
 BEGIN PERFORM public.nh_api_verify_transfer_asset(transfer,'dispatch',prefix||'-WRONG');
 EXCEPTION WHEN invalid_parameter_value THEN denied:=true; END;
 ASSERT denied,'Wrong equipment tag was accepted';
 ASSERT public.nh_api_verify_transfer_asset(transfer,'dispatch',tag)='in_transit','Verified dispatch failed';
 ASSERT public.nh_api_verify_transfer_asset(transfer,'dispatch',tag)='in_transit','Dispatch replay failed';
 denied:=false;
 BEGIN PERFORM public.nh_api_verify_transfer_asset(transfer,'receive',tag);
 EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
 ASSERT denied,'A source-only operator could receive for the destination';

 PERFORM set_config('request.jwt.claim.sub',receiver_auth::text,true);
 ASSERT public.nh_api_verify_transfer_asset(transfer,'receive',tag)='completed','Verified receipt failed';
 ASSERT public.nh_api_verify_transfer_asset(transfer,'receive',tag)='completed','Receipt replay failed';
 ASSERT (SELECT qty FROM public.frontend_equipment_inventory_v WHERE id=destination_item)=1,'Receipt did not move exactly one asset';
 history:=public.nh_api_request_history('equipment',need);
 ASSERT jsonb_path_query_array(history,'$[*].stage')=
 '["requested","reviewed","allocated","reserved","dispatched","in_transit","received","completed"]'::jsonb,'Equipment history stages differ';
 ASSERT jsonb_array_length(jsonb_path_query_array(history,'$[*] ? (@.tagVerified == true)'))=2,'Expected precisely two verified handoff events';

 PERFORM set_config('request.jwt.claim.sub',nurse_auth::text,true);
 enquiry:=public.nh_api_submit_supply_enquiry(category,2,'Hospital-only synthetic reason',due,gen_random_uuid());
 denied:=false;
 BEGIN PERFORM public.nh_api_send_supply_enquiry(enquiry,supplier);
 EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
 ASSERT denied,'Requester could send their own enquiry';

 PERFORM set_config('request.jwt.claim.sub',supplier_auth::text,true);
 denied:=false;
 BEGIN PERFORM public.nh_api_request_history('supplier',enquiry);
 EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
 ASSERT denied,'Supplier saw an unsent enquiry history';

 PERFORM set_config('request.jwt.claim.sub',approver_auth::text,true);
 PERFORM public.nh_api_send_supply_enquiry(enquiry,supplier);
 PERFORM set_config('request.jwt.claim.sub',other_auth::text,true);
 denied:=false;
 BEGIN PERFORM public.nh_api_request_history('supplier',enquiry);
 EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
 ASSERT denied,'Unrelated supplier could view enquiry history';

 PERFORM set_config('request.jwt.claim.sub',supplier_auth::text,true);
 SELECT v INTO payload FROM public.nh_api_list_supply_enquiries() v WHERE v->>'enquiry_id'=enquiry::text;
 ASSERT payload->>'request_reason' IS NULL AND payload->>'needed_by' IS NOT NULL,'Supplier visibility fields incorrect';
 PERFORM public.nh_api_respond_supply_enquiry(enquiry,'unavailable',0,NULL);
 PERFORM public.nh_api_respond_supply_enquiry(enquiry,'partial',1,current_date+1);
 PERFORM public.nh_api_respond_supply_enquiry(enquiry,'available',2,current_date+2);
 PERFORM public.nh_api_respond_supply_enquiry(enquiry,'available',2,current_date+2);
 history:=public.nh_api_request_history('supplier',enquiry);
 ASSERT jsonb_path_query_array(history,'$[*].stage')=
 '["requested","sent","responded","responded","responded"]'::jsonb,'Supplier response history or replay differs';
 ASSERT NOT EXISTS(SELECT 1 FROM jsonb_array_elements(history) e WHERE e ? 'request_reason' OR e ? 'actor_id'),'Supplier history disclosed internal data';

 PERFORM set_config('request.jwt.claim.sub',nurse_auth::text,true);
 SELECT v INTO payload FROM public.nh_api_list_supply_enquiries() v WHERE v->>'enquiry_id'=enquiry::text;
 ASSERT payload->>'status'='responded' AND (payload->>'available_quantity')::int=2,'Hospital cannot read saved supplier response';
 ASSERT (SELECT qty FROM public.frontend_equipment_inventory_v WHERE id=destination_item)=1,'Supplier response changed owned stock';

 EXECUTE format('SET LOCAL ROLE %I',owner_role);
 ASSERT (SELECT count(*) FROM public.asset_reservations WHERE transfer_id=transfer AND released_at IS NOT NULL)=1,'Reservation was not released exactly once';
END $$;
ROLLBACK;
SELECT jsonb_build_object('result','Hosted synthetic workflow assertions passed and rolled back',
 'synthetic_release_fixtures_remaining',(SELECT count(*) FROM public.locations WHERE code LIKE 'NH-TEST-%')) AS verification;
