# Equipment tag handoff demo

The QR code opens Requests with an equipment tag. It carries no credentials, patient information, or transfer ID. The operator must sign in, review the matching transfer, and confirm the action. The database validates the tag against the reserved asset and the operator’s unit scope before changing anything.

## Rehearse

1. Use the [scaled synthetic inventory](../database/11_expand_demo_inventory.sql). With the initial demo stock, Emergency has eight available ventilators. Request one from a different unit, review it independently, set the Emergency reserve to three, and allocate. Verify which asset was reserved before printing or attaching a label. The example label uses `NX-DEMO-SCALE-ER-C6-001`, the first available tag by sort order in the initial dataset.
2. As the source operator, open the QR with the phone’s camera. Sign in if prompted. On Requests, select **Review scanned equipment** and **Confirm dispatch**. On desktop you can use **Verify dispatch** and type the printed tag.
3. Scan as a signed-in operator outside the destination scope. The app offers no confirmation for that account. The database applies the same rule to direct requests.
4. Scan as the destination operator and confirm receipt. Open the transfer timeline and show **Equipment tag matched** at dispatch and receipt. Check that the destination gained one available asset. Replaying either action does not add stock or duplicate events.

The tag verifies the asset identifier. A printed QR can be copied, so a match is evidence of the identifier presented, with site access controlled by Supabase. It does not establish a person’s physical location. The legacy movement endpoint remains available for compatibility, and its events do not get the tag-matched marker.

Deploy the verified handoff migration before the updated frontend. Both are staged for team review. Test writes in a disposable database using synthetic accounts.
