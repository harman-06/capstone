import {readFile} from 'node:fs/promises';
export const migrationPath='supabase/migrations/20261030221131_fair_equipment_allocation.sql';
export const subjects={a:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',b:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',coordinator:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',outsider:'dddddddd-dddd-4ddd-8ddd-dddddddddddd'};
export async function install(exec) {
 await exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA auth;
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 GRANT USAGE ON SCHEMA auth TO authenticated; GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;`);
 for(const name of ['database/00_schema.sql','database/01_workflow_functions.sql','database/02_views.sql','database/03_seed_demo.sql','database/04_rls.sql','database/07_authenticated_workflows.sql','database/08_supplier_enquiries.sql',migrationPath])
  await exec(await readFile(new URL('../'+name,import.meta.url),'utf8'));
 await exec(`INSERT INTO users(email,display_name,home_department_id,auth_subject)
 SELECT 'allocation-'||x.alias||'@example.test',x.alias,l.location_id,x.subject::uuid FROM (VALUES
 ('a','CARD','${subjects.a}'),('b','ONC','${subjects.b}'),('coordinator','ER','${subjects.coordinator}')) x(alias,code,subject) JOIN locations l ON l.code=x.code;
 INSERT INTO user_role_assignments(user_id,role_id,scope_location_id)
 SELECT u.user_id,r.role_id,u.home_department_id FROM users u JOIN roles r ON r.role_key=CASE WHEN u.display_name='coordinator' THEN 'chargeNurse' ELSE 'nurse' END
 WHERE u.email LIKE 'allocation-%@example.test';`);
}
export async function context(query) {
 const rows=await query(`SELECT 'EQ-'||l.location_id||'-'||c.category_id AS source,l.location_id AS source_id,c.category_id
 FROM locations l,equipment_categories c WHERE l.code='ER' AND c.name='Ventilator'`);
 return rows[0];
}
