# Farhan's Database Design Decisions

These choices were made before Lean v3 was created.

1. Inventory: hybrid summary + individual assets.
2. Asset identification: unique asset tags; QR field retained as optional.
3. Equipment structure: category + model + manufacturer.
4. Hospital structure: scalable beyond one hospital.
5. Location: department + room + storage location.
6. Asset states: available, in use, reserved, in transit, maintenance, unavailable, retired, lost.
7. Low stock: calculated from department-specific thresholds.
8. Transfer approval: configurable by department/role.
9. Reservation: reserve on approval to prevent double allocation.
10. History: full event history with user/time/comments.
11. Maintenance: detailed maintenance record including next inspection.
12. Audit: important changes across the whole system.
13. Roles: multiple roles with location scope.
14. Medicine: excluded from the core database.
15. Patients: excluded from the core database.
16. Scale: multi-hospital capable.
17. Notifications: stored with read/unread state.
18. Shortage logic: threshold fields now; more advanced matching later.
19. Security: API/RPC plus database RLS.
20. Ownership target: research + schema + seed/test data + live integration with Harman's inventory page.
