# CRM delivery diagnosis — 2026-09-15

## Follow-up: run 13 and hall validation repair

Run 13 reached the booking service, which now processes requests instead of failing on DNS. The Vercel logs at 08:16 UTC report `Booking validation failed: hall: ... is not a valid enum value`. The bridge always sent `hall: ""` when the optional preference was absent, while the tool did not expose a hall parameter.

The bridge now sends `hall: null` for an undecided preference, avoiding both the invalid empty string and the booking model's implicit Nirvana default. Known values are normalized and unknown values rejected before forwarding. The real booking model was loaded locally and confirmed to accept null and reject an empty string. The existing Dograh tool now exposes optional `hall_preference` and includes required-field/success guidance. The bridge also reads the real response envelope `{ message, booking }`, preserving `booking._id`. All 11 controller tests pass.

Restarting the local bridge revealed a separate configuration regression: its `.env` currently contains the literal `<db_password>` in `MONGODB_URI`. MongoDB reports authentication failed, and the backend exits. Replace that placeholder with the Atlas database-user password (URI-encoded as needed), then restart this backend. The planned live create/read/delete smoke test was not executed because database startup failed. No test booking was created.

## Confirmed deployment cause after Vercel login

Vercel access now works. Runtime logs for production deployment `dpl_EHr59wbqXF2wjfNraa1Ld9ctB27h` show `querySrv ENOTFOUND _mongodb._tcp.cluster0.j00hmb0.mongodb.net`, followed by process exit status 1. Independent DNS checks returned no SRV records for that hostname. This is the direct cause of the booking service's HTTP 500 responses.

Project `budha-avenue-backend` has a `MONGO_URI` environment variable configured for production, preview, and development. Its linked source repository is `arshsid274/Budha-Avenue-Backend`, branch `main`. The local integration backend instead uses `MONGODB_URI` and successfully connects to `cluster0banquetbooking.z7wdloj.mongodb.net`, whose SRV records resolve.

Before changing production, confirm which database should hold the booking records. A working connection to the local integration's database alone does not prove that it is the intended production booking database. Once confirmed, correct production `MONGO_URI`, redeploy, verify a read-only booking endpoint, and then retest enquiry creation. No production environment values or deployments were changed during this inspection.

## Follow-up: run 12

The next browser test reached port 5001. At 07:26:07 UTC its first enquiry submission received a 400 required-fields response. At 07:26:38 UTC the second submission passed local validation, called the external booking API, and received a 502 from the bridge because the upstream booking service returned an error.

Read-only checks of both `https://budha-avenue-backend.vercel.app/api/bookings/create` and the deployment root returned HTTP 500 with plain-text `FUNCTION_INVOCATION_FAILED`. This establishes a deployed booking-service failure, independently of the enquiry payload. The exact server exception requires Vercel runtime logs. `vercel inspect` could not access them because the locally configured Vercel token is invalid.

The bridge previously tried to parse that plain-text error as JSON and logged only `{}`. Its error handling now reports the upstream HTTP status and the known Vercel error code without logging customer data. All seven controller tests pass. The upstream crash remains unresolved; the booking service source is absent from this workspace.

## Confirmed cause of the failed browser test

Workflow 4, run 11, tested draft definition 5. At 07:01:12 UTC the agent executed `create_inbound_enquiry` and posted to `http://host.docker.internal:5000/api/dograh/inbound/enquiries`. The API log recorded HTTP 403 and failure code `custom-http-403`.

An independent request from the API container returned HTTP 403 with `Server: AirTunes/980.77.5`. macOS Control Center was listening on port 5000. The request reached Apple AirPlay, not the CRM. The CRM's own authentication middleware returns 401 for an invalid key, so this 403 was not evidence of a bad CRM credential.

## Repairs applied

- Moved the CRM default, local `.env`, and example configuration to port 5001. Startup logs now print the actual port.
- Started the CRM and verified its configured MongoDB connection.
- Updated the existing organization 1 enquiry tool URL to `http://host.docker.internal:5001/api/dograh/inbound/enquiries`.
- Verified connectivity and the existing Dograh credential from the API container using an empty enquiry request. Express returned the expected 400 required-fields response before any booking/database write.
- Fixed pre-call input parsing: Dograh sends `call_inbound.from_number`; the controller previously only accepted top-level caller fields.
- Fixed pre-call output: Dograh expects an `initial_context` envelope; the controller previously returned a flat object that Dograh's context extractor ignores.
- Made call-result handling accept JSON-encoded context strings, as produced by Dograh's template renderer, as well as objects. Corrected the documented webhook JSON template.
- Added six passing tests with mocked network/database calls. Run `npm test` in this backend directory.

## Remaining workflow setup

The database inspection showed:

1. Workflow 4's published definition is 4. Its Agent node has no enquiry tool. Draft definition 5 used by the browser test has the tool attached. Real inbound calls using the published version will not have that tool until a corrected workflow is published.
2. Neither definition has a Webhook node. There are zero webhook-delivery rows. No end-of-call CRM delivery has been queued.
3. Variable extraction is disabled on the End Call node. Enable the documented fields if structured call results are needed.
4. The prompt tells the agent to call the enquiry tool after collecting name, event date, and guest count, but the tool also requires `caller_number`. Browser tests must ask for a phone number. The prompt should only announce that an enquiry was saved after a successful tool response.

The `/call-results` route only saves an `InboundCall` document. It does not create a booking. Booking-list entries require a successful `/enquiries` call, which forwards to the separate booking API before saving a local enquiry record.

## Verification limits

No customer bookings were created or replayed during diagnosis. The external booking API's acceptance of a complete enquiry payload remains unverified; its implementation is not present in this workspace. In particular, the CRM form requires a rate plan, while the integration payload omits it; whether the server requires it cannot be established from frontend validation alone.

The corrected URL is suitable for Docker Desktop on this Mac while this CRM process is running. Remote deployment requires a reachable CRM URL. The workflow was not published as part of this diagnosis.
