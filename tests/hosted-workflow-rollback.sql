-- Run only through a trusted SQL connection. All synthetic records are rolled back.
-- This verifies hosted PostgreSQL functions and grants, not browser/JWT issuance.
BEGIN;
DO $$
DECLARE
 owner_role text:=current_user; h uuid; src uuid; dst uuid; model uuid; category uuid;
 nurse uuid; reviewer uuid; nurse_auth uuid:=gen_random_uuid(); reviewer_auth uuid:=gen_random_uuid();
 supplier_auth uuid:=gen_random_uuid(); unrelated_auth uuid:=gen_random_uuid();
 supplier uuid; other_supplier uuid; request uuid; enquiry uuid; payload jsonb;
 prefix text:='NH-TEST-'||substr(gen_random_uuid()::text,1,8); denied boolean; events_before bigint;
BEGIN
 SELECT model_id,category_id INTO STRICT model,category FROM public.equipment_models ORDER BY model_id LIMIT 1;
 INSERT INTO public.locations(location_type,code,name) VALUES('hospital',prefix,'Synthetic rollback hospital') RETURNING location_id INTO h;
 INSERT INTO public.locations(parent_location_id,location_type,code,name) VALUES(h,'department',prefix||'-S','Synthetic source') RETURNING location_id INTO src;
 INSERT INTO public.locations(parent_location_id,location_type,code,name) VALUES(h,'department',prefix||'-D','Synthetic destination') RETURNING location_id INTO dst;
 INSERT INTO public.equipment_assets(asset_tag,model_id,current_location_id,asset_status)
 VALUES(prefix||'-ASSET',model,src,'available');
 INSERT INTO public.users(auth_subject,email,display_name,home_department_id)
 VALUES(nurse_auth,prefix||'-nurse@example.test','Synthetic nurse',dst) RETURNING user_id INTO nurse;
 INSERT INTO public.users(auth_subject,email,display_name,home_department_id)
 VALUES(reviewer_auth,prefix||'-reviewer@example.test','Synthetic reviewer',src) RETURNING user_id INTO reviewer;
 INSERT INTO public.user_role_assignments(user_id,role_id,scope_location_id)
 SELECT nurse,role_id,dst FROM public.roles WHERE role_key='nurse';
 INSERT INTO public.user_role_assignments(user_id,role_id,scope_location_id)
 SELECT reviewer,role_id,h FROM public.roles WHERE role_key='chargeNurse';
 -- The requester also holds an otherwise applicable approval role. Self-approval must still fail.
 INSERT INTO public.user_role_assignments(user_id,role_id,scope_location_id)
 SELECT nurse,role_id,h FROM public.roles WHERE role_key='chargeNurse';
 INSERT INTO public.approval_policies(source_department_id,required_role_id)
 SELECT src,role_id FROM public.roles WHERE role_key='chargeNurse';
 INSERT INTO public.nh_suppliers(hospital_id,name) VALUES(h,prefix||' Supplier') RETURNING supplier_id INTO supplier;
 INSERT INTO public.nh_suppliers(hospital_id,name) VALUES(h,prefix||' Other supplier') RETURNING supplier_id INTO other_supplier;
 INSERT INTO public.nh_supplier_memberships(auth_subject,supplier_id)
 VALUES(supplier_auth,supplier),(unrelated_auth,other_supplier);
 EXECUTE 'SET LOCAL ROLE authenticated';
 PERFORM set_config('request.jwt.claim.sub',nurse_auth::text,true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',nurse_auth,'role','authenticated')::text,true);
 request:=public.nh_api_enqueue_equipment('EQ-'||src::text||'-'||category::text,gen_random_uuid(),'Synthetic rollback request');
 ASSERT (SELECT count(*) FROM public.nh_api_list_allocation_queue())=1,'Requester cannot retrieve queued request';
 denied:=false;
 BEGIN PERFORM public.nh_api_review_allocation(request,3,NULL,'Self review attempt denied'); EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
 ASSERT denied,'Self-review was allowed';
 PERFORM set_config('request.jwt.claim.sub',reviewer_auth::text,true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',reviewer_auth,'role','authenticated')::text,true);
 PERFORM public.nh_api_configure_allocation(src,category,0);
 PERFORM public.nh_api_review_allocation(request,1,NULL,'Synthetic routine request verified');
 payload:=public.nh_api_allocate_next(src,category,gen_random_uuid());
 ASSERT payload->>'outcome'='allocated','Queue did not allocate equipment';
 SELECT v INTO payload FROM public.nh_api_list_transfers() v;
 ASSERT payload->>'status'='reserved','Allocation did not reserve equipment';
 ASSERT (public.nh_api_allocate_next(src,category,gen_random_uuid())->>'outcome')='no_eligible_requests','Queue allocated the same request twice';
 PERFORM set_config('request.jwt.claim.sub',nurse_auth::text,true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',nurse_auth,'role','authenticated')::text,true);
 enquiry:=public.nh_api_create_supply_enquiry(category,2,'Hospital-only synthetic note');
 denied:=false;
 BEGIN PERFORM public.nh_api_send_supply_enquiry(enquiry,supplier); EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
 ASSERT denied,'Requester could authorize own external enquiry';
 PERFORM set_config('request.jwt.claim.sub',supplier_auth::text,true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',supplier_auth,'role','authenticated')::text,true);
 ASSERT (SELECT count(*) FROM public.nh_api_list_supply_enquiries())=0,'Supplier saw an unsent internal enquiry';
 PERFORM set_config('request.jwt.claim.sub',reviewer_auth::text,true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',reviewer_auth,'role','authenticated')::text,true);
 PERFORM public.nh_api_send_supply_enquiry(enquiry,supplier);
 PERFORM set_config('request.jwt.claim.sub',unrelated_auth::text,true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',unrelated_auth,'role','authenticated')::text,true);
 ASSERT (SELECT count(*) FROM public.nh_api_list_supply_enquiries())=0,'An unrelated supplier saw the enquiry';
 denied:=false;
 BEGIN PERFORM public.nh_api_respond_supply_enquiry(enquiry,'available',2); EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
 ASSERT denied,'Unrelated supplier could respond';
 PERFORM set_config('request.jwt.claim.sub',supplier_auth::text,true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',supplier_auth,'role','authenticated')::text,true);
 SELECT v INTO payload FROM public.nh_api_list_supply_enquiries() v;
 ASSERT payload->>'request_reason' IS NULL,'Hospital-only reason leaked';
 PERFORM public.nh_api_respond_supply_enquiry(enquiry,'available',2,current_date+2);
 denied:=false;
 BEGIN PERFORM 1 FROM public.nh_supply_enquiries; EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
 ASSERT denied,'Direct supplier table read was allowed';
 EXECUTE format('SET LOCAL ROLE %I',owner_role);
 SELECT count(*) INTO events_before FROM public.nh_supply_events WHERE enquiry_id=enquiry;
 EXECUTE 'SET LOCAL ROLE authenticated';
 PERFORM public.nh_api_respond_supply_enquiry(enquiry,'available',2,current_date+2);
 EXECUTE format('SET LOCAL ROLE %I',owner_role);
 ASSERT (SELECT count(*) FROM public.nh_supply_events WHERE enquiry_id=enquiry)=events_before,'Repeated response duplicated events';
 EXECUTE 'SET LOCAL ROLE authenticated';
 PERFORM set_config('request.jwt.claim.sub',nurse_auth::text,true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',nurse_auth,'role','authenticated')::text,true);
 SELECT v INTO payload FROM public.nh_api_list_supply_enquiries() v;
 ASSERT payload->>'status'='responded' AND (payload->>'available_quantity')::int=2,'Hospital cannot retrieve supplier response';
 EXECUTE format('SET LOCAL ROLE %I',owner_role);
END $$;
ROLLBACK;
SELECT jsonb_build_object('result','Hosted workflow assertions passed; synthetic records rolled back',
 'existing_assets',(SELECT count(*) FROM public.equipment_assets),
 'existing_transfers',(SELECT count(*) FROM public.transfer_requests),
 'allocation_requests',(SELECT count(*) FROM public.nh_allocation_requests),
 'enquiries',(SELECT count(*) FROM public.nh_supply_enquiries)) AS verification;
