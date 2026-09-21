# Dograh inbound booking agent

The CRM now exposes a small, authenticated integration surface for Dograh. It is designed for an inbound call: Dograh looks up the caller before greeting them, saves a new enquiry when appropriate, and writes the completed call back to the CRM.

## 1. Deploy this backend

Deploy `Bcakend_Banquet` to a public HTTPS URL. Add the variables from `.env.example`; keep `DOGRAH_CRM_WEBHOOK_SECRET` private. The existing booking API stays configurable through `BOOKING_API_URL`.

For a local test, run this backend on port 5001 (`npm run dev`). Port 5000 is commonly occupied by macOS AirPlay, which returns an empty 403 response with `Server: AirTunes` instead of reaching Express. For Dograh running in Docker on this Mac, use `http://host.docker.internal:5001/api/dograh/inbound/...`. For a remotely hosted Dograh, expose port 5001 using a public HTTPS tunnel. A remote service cannot reach this Mac through `localhost` or `host.docker.internal`.

When using MongoDB Atlas, replace the literal `<db_password>` in the copied URI with the database user's password, URI-encoding reserved characters. This backend reads `MONGODB_URI`; the separate deployed booking backend reads `MONGO_URI`.

## 2. Create the Dograh workflow

Create an **Inbound** workflow named `Budha Avenue Booking Reception` and use this Start Call configuration:

- Greeting: `Welcome to Budha Avenue. How may I help you today?`
- Pre-Call Data Fetch: `Inbound calls only`
- Endpoint URL: `https://YOUR-CRM/api/dograh/inbound/context`
- Authentication: an HTTP-header credential named `X-Dograh-CRM-Key` with the same secret as `DOGRAH_CRM_WEBHOOK_SECRET`.

Use this prompt on the Start Call or Agent node:

```
You are the helpful reception agent for Budha Avenue Banquet Hall.
This is an incoming phone call. Keep replies short and natural, and ask one question at a time.
If customer_found is true, say you found the caller's booking and confirm only their name and event date before discussing it. Never reveal booking details until they confirm their name.
If customer_found is false, collect a booking enquiry. Work through the details the booking form needs, in this order:
1. Name.
2. Event date.
3. Guest count, in number of people.
4. Event type, such as wedding, reception, birthday, or corporate.
5. Start time. Convert what they say into 24-hour HH:MM, so "half past seven in the evening" becomes 19:30.
6. Hall preference: Nirvana, Mandala, Conference, or Lawn.
7. Food type: Veg or Non-Veg.
8. Rate plan: Silver, Gold, or Platinum. Describe these as packages only. Never quote a price or a per-plate rate.
9. Rooms: whether they need only the complimentary room, an additional room, or both. If they want additional rooms, ask how many.
10. Whether the number they are calling from is also their WhatsApp number, and take the other number if it is different.
11. Email address.
12. Whether they would like a callback.
Ask every one of these, but never invent an answer. If the caller is undecided about the time, hall, food type, rate plan, or rooms, leave that detail out of the tool call and tell them staff will confirm it with them. Do not promise availability, pricing, or a confirmed booking.
Send the hall, food type, rate plan, and room option using exactly the words listed above, because the CRM rejects any other value.
Use create_inbound_enquiry only once the caller has given their name, event date, and guest count. Tell them that you have created an enquiry and staff will confirm availability. This adds an Enquiry record directly to the CRM booking list.
For booking changes, record the request and explain that staff will confirm it.
```

Turn on variable extraction at End Call with: `call_outcome`, `summary`, `callback_requested`, `event_date`, `guest_count`, `event_time`, `hall_preference`, `food_type`, and `rate_plan`.

## 3. Add the two Dograh HTTP tools

Both tools require the same `X-Dograh-CRM-Key` header credential.

The bridge accepts only the values the CRM booking form offers, matched case-insensitively so a spoken "gold" or "non veg" still resolves:

| Field | Accepted values |
| --- | --- |
| `hall_preference` | `Nirvana`, `Mandala`, `Conference`, `Lawn` |
| `rate_plan` | `Silver`, `Gold`, `Platinum` |
| `food_type` | `Veg`, `Non-Veg` (defaults to `Veg` when omitted) |
| `room_option` | `complimentary`, `additional`, `both` |

Anything else is rejected with a 400 before the booking service is contacted, so the agent must not pass a paraphrase. Omit a field entirely when the caller is undecided: the bridge stores an undecided hall as null, leaves the other fields unset rather than blank, and writes a staff-confirmation note for a missing hall, rate plan, or start time.

| Tool | Method and URL | Parameters |
| --- | --- | --- |
| `create_inbound_enquiry` | `POST https://YOUR-CRM/api/dograh/inbound/enquiries` | Required: `caller_number`, `name`, `event_date`, `guest_count`. Optional: `time` (24-hour `HH:MM`), `event_type`, `hall_preference`, `food_type`, `rate_plan`, `room_option`, `complimentary_rooms`, `extra_rooms`, `whatsapp`, `email`, `notes`, `callback_requested` |
| `save_inbound_call_result` | `POST https://YOUR-CRM/api/dograh/inbound/call-results` | Used by the final webhook, not during the call. |

Add a Webhook node after End Call with URL `https://YOUR-CRM/api/dograh/inbound/call-results` and this payload:

Configure the same `X-Dograh-CRM-Key` credential on the Webhook node itself. Saving a call result only creates a call log; it does not create a booking. Attach `create_inbound_enquiry` to the Agent node to create the booking, and require the agent to announce success only after the tool returns success. In browser tests there is no incoming phone number: explicitly ask the customer for their phone number before calling the tool.

```json
{
  "workflow_run_id": "{{workflow_run_id}}",
  "initial_context": "{{initial_context}}",
  "gathered_context": "{{gathered_context}}",
  "transcript_url": "{{transcript_url}}",
  "recording_url": "{{recording_url}}"
}
```

The CRM booking form marks `rate_plan` and `food_type` required, but they stay optional on this tool on purpose: a caller who has not chosen a package should still leave an enquiry behind rather than have the tool call fail mid-conversation. Staff complete those fields when they confirm the booking.

## 4. Route the business number

In Dograh, add the business number under the telephony provider configuration, set this workflow as the number's **Inbound workflow**, then publish the workflow. Dograh will configure the provider to send incoming calls to its own `/api/v1/telephony/inbound/run` dispatcher. Do not point the phone provider at the CRM endpoint.

## Verify it

Call the number from a phone that matches an existing booking, then call from an unrecognised number and ask about a new event. Confirm saved records at `GET /api/dograh/inbound/calls` and `GET /api/dograh/inbound/enquiries` using the secret header.
