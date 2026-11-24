BEGIN;
-- Synthetic demo data aligned to Harman's current departments.

INSERT INTO locations(location_type, code, name)
VALUES ('hospital','NDH','Nexora Demo Hospital')
ON CONFLICT (code) DO NOTHING;

INSERT INTO locations(parent_location_id, location_type, code, name, floor)
SELECT location_id,'department','CARD','Cardiology',3
FROM locations WHERE code='NDH'
ON CONFLICT (code) DO NOTHING;

INSERT INTO locations(parent_location_id, location_type, code, name, floor)
SELECT location_id,'department','ONC','Oncology',5
FROM locations WHERE code='NDH'
ON CONFLICT (code) DO NOTHING;

INSERT INTO locations(parent_location_id, location_type, code, name, floor)
SELECT location_id,'department','ER','Emergency',1
FROM locations WHERE code='NDH'
ON CONFLICT (code) DO NOTHING;

-- Detailed locations
INSERT INTO locations(parent_location_id, location_type, code, name)
SELECT location_id,'room','CARD-R301','Room 301'
FROM locations WHERE code='CARD'
ON CONFLICT (code) DO NOTHING;

INSERT INTO locations(parent_location_id, location_type, code, name)
SELECT location_id,'storage','CARD-BAYA','Equipment Bay A'
FROM locations WHERE code='CARD-R301'
ON CONFLICT (code) DO NOTHING;

INSERT INTO locations(parent_location_id, location_type, code, name)
SELECT location_id,'room','ONC-R501','Room 501'
FROM locations WHERE code='ONC'
ON CONFLICT (code) DO NOTHING;

INSERT INTO locations(parent_location_id, location_type, code, name)
SELECT location_id,'storage','ONC-BAYA','Equipment Bay A'
FROM locations WHERE code='ONC-R501'
ON CONFLICT (code) DO NOTHING;

INSERT INTO locations(parent_location_id, location_type, code, name)
SELECT location_id,'room','ER-EQ','ER Equipment Room'
FROM locations WHERE code='ER'
ON CONFLICT (code) DO NOTHING;

INSERT INTO locations(parent_location_id, location_type, code, name)
SELECT location_id,'storage','ER-BAYA','Equipment Bay A'
FROM locations WHERE code='ER-EQ'
ON CONFLICT (code) DO NOTHING;

INSERT INTO equipment_categories(name) VALUES
('Infusion Pump'),
('Ventilator'),
('Defibrillator'),
('Wheelchair'),
('Patient Monitor'),
('Portable Ultrasound')
ON CONFLICT (name) DO NOTHING;

INSERT INTO equipment_models(category_id,manufacturer,model_name)
SELECT category_id,'DemoMed','IP-200'
FROM equipment_categories WHERE name='Infusion Pump'
ON CONFLICT DO NOTHING;

INSERT INTO equipment_models(category_id,manufacturer,model_name)
SELECT category_id,'Hamilton Medical','C6'
FROM equipment_categories WHERE name='Ventilator'
ON CONFLICT DO NOTHING;

INSERT INTO equipment_models(category_id,manufacturer,model_name)
SELECT category_id,'DemoMed','DEF-100'
FROM equipment_categories WHERE name='Defibrillator'
ON CONFLICT DO NOTHING;

INSERT INTO equipment_models(category_id,manufacturer,model_name)
SELECT category_id,'DemoMobility','WC-100'
FROM equipment_categories WHERE name='Wheelchair'
ON CONFLICT DO NOTHING;

INSERT INTO equipment_models(category_id,manufacturer,model_name)
SELECT category_id,'DemoMed','PM-100'
FROM equipment_categories WHERE name='Patient Monitor'
ON CONFLICT DO NOTHING;

INSERT INTO equipment_models(category_id,manufacturer,model_name)
SELECT category_id,'DemoImaging','US-Portable'
FROM equipment_categories WHERE name='Portable Ultrasound'
ON CONFLICT DO NOTHING;

-- Demo assets: 4 pumps in Cardiology
INSERT INTO equipment_assets(asset_tag,model_id,current_location_id,asset_status,serial_number)
SELECT 'NX-PUMP-CARD-' || lpad(n::text,3,'0'),
       em.model_id, loc.location_id,
       CASE WHEN n <= 4 THEN 'available' ELSE 'in_use' END,
       'PUMP-CARD-' || lpad(n::text,3,'0')
FROM generate_series(1,4) n
JOIN equipment_models em ON em.model_name='IP-200'
JOIN locations loc ON loc.code='CARD-BAYA'
ON CONFLICT (asset_tag) DO NOTHING;

-- 1 ventilator in Oncology (low)
INSERT INTO equipment_assets(asset_tag,model_id,current_location_id,asset_status,serial_number)
SELECT 'NX-VEN-ONC-001', em.model_id, loc.location_id, 'available','VEN-ONC-001'
FROM equipment_models em
JOIN locations loc ON loc.code='ONC-BAYA'
WHERE em.model_name='C6'
ON CONFLICT (asset_tag) DO NOTHING;

-- 2 ventilators in ER
INSERT INTO equipment_assets(asset_tag,model_id,current_location_id,asset_status,serial_number)
SELECT 'NX-VEN-ER-' || lpad(n::text,3,'0'),
       em.model_id, loc.location_id, 'available',
       'VEN-ER-' || lpad(n::text,3,'0')
FROM generate_series(1,2) n
JOIN equipment_models em ON em.model_name='C6'
JOIN locations loc ON loc.code='ER-BAYA'
ON CONFLICT (asset_tag) DO NOTHING;

-- 2 defibrillators in ER
INSERT INTO equipment_assets(asset_tag,model_id,current_location_id,asset_status,serial_number)
SELECT 'NX-DEF-ER-' || lpad(n::text,3,'0'),
       em.model_id, loc.location_id, 'available',
       'DEF-ER-' || lpad(n::text,3,'0')
FROM generate_series(1,2) n
JOIN equipment_models em ON em.model_name='DEF-100'
JOIN locations loc ON loc.code='ER-BAYA'
ON CONFLICT (asset_tag) DO NOTHING;

-- Thresholds
INSERT INTO inventory_thresholds(department_id,category_id,low_threshold)
SELECT d.location_id,c.category_id,1
FROM locations d
CROSS JOIN equipment_categories c
WHERE d.location_type='department'
ON CONFLICT (department_id,category_id) DO NOTHING;

-- Demo users
INSERT INTO users(email,display_name,home_department_id)
SELECT 'nadia.ali@example.test','Nadia Ali',location_id
FROM locations WHERE code='CARD'
ON CONFLICT (email) DO NOTHING;

INSERT INTO users(email,display_name,home_department_id)
SELECT 'eli.brown@example.test','Eli Brown',location_id
FROM locations WHERE code='CARD'
ON CONFLICT (email) DO NOTHING;

INSERT INTO users(email,display_name,home_department_id)
SELECT 'sam.lee@example.test','Sam Lee',location_id
FROM locations WHERE code='NDH'
ON CONFLICT (email) DO NOTHING;

-- Role assignments
INSERT INTO user_role_assignments(user_id,role_id,scope_location_id)
SELECT u.user_id,r.role_id,d.location_id
FROM users u, roles r, locations d
WHERE u.email='nadia.ali@example.test'
  AND r.role_key='chargeNurse'
  AND d.code='CARD'
ON CONFLICT DO NOTHING;

INSERT INTO user_role_assignments(user_id,role_id,scope_location_id)
SELECT u.user_id,r.role_id,d.location_id
FROM users u, roles r, locations d
WHERE u.email='eli.brown@example.test'
  AND r.role_key='nurse'
  AND d.code='CARD'
ON CONFLICT DO NOTHING;

INSERT INTO user_role_assignments(user_id,role_id,scope_location_id)
SELECT u.user_id,r.role_id,d.location_id
FROM users u, roles r, locations d
WHERE u.email='sam.lee@example.test'
  AND r.role_key='admin'
  AND d.code='NDH'
ON CONFLICT DO NOTHING;

-- Configurable approval policies
INSERT INTO approval_policies(source_department_id,required_role_id)
SELECT d.location_id,r.role_id
FROM locations d, roles r
WHERE d.location_type='department'
  AND r.role_key='chargeNurse'
ON CONFLICT DO NOTHING;

COMMIT;
