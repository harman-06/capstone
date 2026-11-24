BEGIN;

-- Additive inventory for the synthetic capstone demo. Never reset existing assets.
DO $$
DECLARE matches integer;
BEGIN
 SELECT count(*) INTO matches
 FROM public.locations h JOIN public.locations d ON d.parent_location_id=h.location_id
 WHERE h.code='NDH' AND h.name='Nexora Demo Hospital' AND h.location_type='hospital'
  AND h.is_active AND d.is_active AND d.location_type='department' AND d.code IN ('CARD','ER','ONC');
 IF matches<>3 THEN RAISE EXCEPTION 'Expected all three Nexora demo departments'; END IF;
 SELECT count(DISTINCT m.model_name) INTO matches
 FROM public.equipment_models m JOIN public.equipment_categories c USING(category_id)
 WHERE (m.model_name,c.name) IN (('IP-200','Infusion Pump'),('C6','Ventilator'),
  ('DEF-100','Defibrillator'),('WC-100','Wheelchair'),
  ('PM-100','Patient Monitor'),('US-Portable','Portable Ultrasound'));
 IF matches<>6 THEN RAISE EXCEPTION 'Expected all six Nexora demo equipment models'; END IF;
END $$;

-- Additional asset counts by department. Portable ultrasound stays unavailable.
WITH stock(unit,model,category,available,in_use,maintenance) AS (VALUES
 ('CARD','IP-200','Infusion Pump',8,6,2),
 ('CARD','C6','Ventilator',0,2,1),
 ('CARD','DEF-100','Defibrillator',2,1,0),
 ('CARD','WC-100','Wheelchair',8,2,1),
 ('CARD','PM-100','Patient Monitor',5,4,1),
 ('CARD','US-Portable','Portable Ultrasound',0,0,1),
 ('ER','IP-200','Infusion Pump',6,4,1),
 ('ER','C6','Ventilator',6,3,1),
 ('ER','DEF-100','Defibrillator',2,1,0),
 ('ER','WC-100','Wheelchair',8,3,0),
 ('ER','PM-100','Patient Monitor',5,5,1),
 ('ER','US-Portable','Portable Ultrasound',0,0,1),
 ('ONC','IP-200','Infusion Pump',7,6,1),
 ('ONC','C6','Ventilator',0,2,0),
 ('ONC','DEF-100','Defibrillator',2,0,0),
 ('ONC','WC-100','Wheelchair',5,2,0),
 ('ONC','PM-100','Patient Monitor',4,3,0)
)
INSERT INTO public.equipment_assets(asset_tag,model_id,current_location_id,asset_status,notes)
SELECT 'NX-DEMO-SCALE-'||s.unit||'-'||s.model||'-'||lpad(n::text,3,'0'),
 model.model_id,d.location_id,
 CASE WHEN n<=s.available THEN 'available'
      WHEN n<=s.available+s.in_use THEN 'in_use' ELSE 'maintenance' END,
 'Synthetic capstone inventory expansion'
FROM stock s
JOIN public.locations d ON d.code=s.unit
JOIN public.locations h ON h.location_id=d.parent_location_id AND h.code='NDH'
JOIN public.equipment_categories c ON c.name=s.category
JOIN LATERAL (
 SELECT m.model_id FROM public.equipment_models m
 WHERE m.category_id=c.category_id AND m.model_name=s.model ORDER BY m.model_id LIMIT 1
) model ON true
CROSS JOIN LATERAL generate_series(1,s.available+s.in_use+s.maintenance) n
ON CONFLICT (asset_tag) DO NOTHING;

COMMIT;
