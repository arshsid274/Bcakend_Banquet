const crypto = require('crypto');
const InboundCall = require('../models/InboundCall');
const InboundEnquiry = require('../models/InboundEnquiry');

const bookingApiUrl = () => process.env.BOOKING_API_URL || 'https://budha-avenue-backend.vercel.app/api';

function normalizePhone(value) {
  return String(value || '').replace(/[^0-9]/g, '').replace(/^91(?=\d{10}$)/, '');
}

function contextObject(value) {
  const parsed = typeof value === 'string' ? JSON.parse(value) : (value || {});
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Call context must be a JSON object');
  }
  return parsed;
}

// The CRM stores these as enums. Match case-insensitively so the speech-to-text
// casing of a spoken answer ("gold", "non veg") still resolves to a valid value.
function matchChoice(value, allowed) {
  const requested = String(value || '').trim();
  if (!requested) return { requested, value: undefined };
  const normalise = (text) => text.toLowerCase().replace(/[^a-z]/g, '');
  return { requested, value: allowed.find((option) => normalise(option) === normalise(requested)) };
}

function choiceOrFail(res, value, allowed, field) {
  const { requested, value: matched } = matchChoice(value, allowed);
  if (requested && !matched) {
    res.status(400).json({ error: `${field} must be ${allowed.join(', ')}; omit it if the caller is undecided` });
    return { failed: true };
  }
  return { failed: false, value: matched };
}

function roomCount(value) {
  const count = Number(value);
  return Number.isInteger(count) && count >= 0 ? count : undefined;
}

function requiresDograhKey(req, res, next) {
  const expected = process.env.DOGRAH_CRM_WEBHOOK_SECRET;
  const received = req.get('X-Dograh-CRM-Key');
  if (!expected || !received || expected.length !== received.length ||
      !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(received))) {
    return res.status(401).json({ error: 'Unauthorized Dograh request' });
  }
  next();
}

async function findBookingsForPhone(callerNumber) {
  const phone = normalizePhone(callerNumber);
  if (!phone) return [];
  const response = await fetch(`${bookingApiUrl()}/bookings/search?q=${encodeURIComponent(phone)}`);
  if (!response.ok) throw new Error(`Booking lookup returned ${response.status}`);
  const body = await response.json();
  const bookings = Array.isArray(body) ? body : (body.data || []);
  return bookings.filter((booking) => normalizePhone(booking.number || booking.phone) === phone);
}

exports.preCallContext = async (req, res) => {
  try {
    const callerNumber = req.body.call_inbound?.from_number || req.body.caller_number || req.body.callerNumber;
    const bookings = await findBookingsForPhone(callerNumber);
    const current = bookings.find((item) => item.bookingStatus !== 'Cancelled') || bookings[0];
    return res.json({ initial_context: {
      customer_found: Boolean(current),
      customer_name: current?.name || '',
      booking_id: current?._id || '',
      booking_date: current?.startDate || '',
      guest_count: current?.pax || '',
      hall: current?.hall || '',
      booking_status: current?.bookingStatus || '',
      booking_count: bookings.length,
    } });
  } catch (error) {
    console.error('Dograh pre-call lookup failed:', error.message);
    // A lookup problem must not stop an incoming customer call.
    return res.json({ initial_context: { customer_found: false, lookup_unavailable: true } });
  }
};

exports.createEnquiry = async (req, res) => {
  try {
    const callerNumber = req.body.caller_number || req.body.callerNumber;
    const eventDate = req.body.event_date || req.body.eventDate;
    const guestCount = Number(req.body.guest_count || req.body.guestCount);
    if (!callerNumber || !req.body.name || !eventDate || !Number.isFinite(guestCount) || guestCount < 1) {
      return res.status(400).json({ error: 'name, caller_number, event_date, and guest_count are required' });
    }
    const hallCheck = choiceOrFail(res, req.body.hall_preference || req.body.hallPreference,
      ['Nirvana', 'Mandala', 'Conference', 'Lawn'], 'hall_preference');
    if (hallCheck.failed) return;
    const hall = hallCheck.value;

    // The CRM booking form also requires a rate plan and a food type, and staff
    // need the start time and room requirement. The agent asks for all of them,
    // but an undecided caller still gets an enquiry rather than a rejection.
    const ratePlanCheck = choiceOrFail(res, req.body.rate_plan || req.body.ratePlan,
      ['Silver', 'Gold', 'Platinum'], 'rate_plan');
    if (ratePlanCheck.failed) return;
    const ratePlan = ratePlanCheck.value;

    const foodTypeCheck = choiceOrFail(res, req.body.food_type || req.body.foodType,
      ['Veg', 'Non-Veg'], 'food_type');
    if (foodTypeCheck.failed) return;
    const foodType = foodTypeCheck.value || 'Veg';

    const roomOptionCheck = choiceOrFail(res, req.body.room_option || req.body.roomOption,
      ['complimentary', 'additional', 'both'], 'room_option');
    if (roomOptionCheck.failed) return;
    const roomOption = roomOptionCheck.value;

    const complimentaryRooms = roomCount(req.body.complimentary_rooms ?? req.body.complimentaryRooms);
    const extraRooms = roomCount(req.body.extra_rooms ?? req.body.extraRooms);
    const eventTime = String(req.body.time || req.body.event_time || req.body.eventTime || '').trim();
    const whatsappNumber = String(req.body.whatsapp || req.body.whatsapp_number || '').trim() || callerNumber;

    // This uses the same booking-create API as the CRM form.  The record starts
    // as an Enquiry: staff still approve availability, menus, and pricing.
    const bookingPayload = {
      name: req.body.name,
      email: req.body.email,
      number: callerNumber,
      whatsapp: whatsappNumber,
      pax: guestCount,
      startDate: eventDate,
      // An empty string violates the CRM enum. Null keeps the preference
      // undecided instead of allowing its default to assign Nirvana.
      hall: hall || null,
      time: eventTime,
      bookingStatus: 'Enquiry',
      statusHistory: [{ status: 'Enquiry', changedAt: new Date().toISOString() }],
      foodType,
      // Omitted rather than blanked: an empty string would fail the CRM enum.
      ...(ratePlan ? { ratePlan } : {}),
      ...(roomOption ? { roomOption } : {}),
      ...(complimentaryRooms === undefined ? {} : { complimentaryRooms }),
      ...(extraRooms === undefined ? {} : { extraRooms }),
      notes: [
        'Created by Dograh inbound booking agent.',
        !hall ? 'Hall preference not yet selected; staff to confirm.' : '',
        !ratePlan ? 'Rate plan not yet selected; staff to confirm.' : '',
        !eventTime ? 'Start time not yet given; staff to confirm.' : '',
        req.body.event_type ? `Event type: ${req.body.event_type}` : '',
        req.body.notes || '',
      ].filter(Boolean).join(' '),
      advance: 0,
      total: 0,
      balance: 0,
      isEnquiry: true,
      isTentative: false,
      isConfirmed: false,
      staffEditCount: 0,
    };
    const bookingResponse = await fetch(`${bookingApiUrl()}/bookings/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bookingPayload),
    });
    if (!bookingResponse.ok) {
      // Hosting failures can be plain text, not JSON. Preserve the status and
      // known provider error without exposing customer data from the response.
      const failureBody = await bookingResponse.text();
      const providerError = failureBody.includes('FUNCTION_INVOCATION_FAILED')
        ? 'FUNCTION_INVOCATION_FAILED' : undefined;
      console.error('CRM booking creation failed:', {
        upstream_status: bookingResponse.status,
        provider_error: providerError,
      });
      return res.status(502).json({
        error: 'The CRM booking service rejected the request; the enquiry was not saved',
        upstream_status: bookingResponse.status,
        provider_error: providerError,
      });
    }
    const bookingBody = await bookingResponse.json();
    const booking = bookingBody.booking || bookingBody;

    const enquiry = await InboundEnquiry.create({
      callerNumber,
      whatsappNumber,
      name: req.body.name,
      email: req.body.email,
      eventDate,
      eventTime,
      guestCount,
      eventType: req.body.event_type || req.body.eventType,
      hallPreference: hall,
      ratePlan,
      foodType,
      roomOption,
      complimentaryRooms,
      extraRooms,
      notes: req.body.notes,
      callbackRequested: Boolean(req.body.callback_requested || req.body.callbackRequested),
      crmBookingId: booking._id || booking.id,
    });
    return res.status(201).json({ enquiry_id: enquiry.id, booking_id: enquiry.crmBookingId, booking_status: 'Enquiry' });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
};

exports.saveCallResult = async (req, res) => {
  try {
    const workflowRunId = String(req.body.workflow_run_id || req.body.workflowRunId || '');
    if (!workflowRunId) return res.status(400).json({ error: 'workflow_run_id is required' });
    const initialContext = contextObject(req.body.initial_context);
    const gatheredContext = contextObject(req.body.gathered_context);
    const call = await InboundCall.findOneAndUpdate(
      { workflowRunId },
      {
        workflowRunId,
        callerNumber: initialContext.caller_number || req.body.caller_number,
        callOutcome: gatheredContext.call_outcome || req.body.call_outcome,
        summary: gatheredContext.summary || req.body.summary,
        gatheredContext,
        transcriptUrl: req.body.transcript_url,
        recordingUrl: req.body.recording_url,
      },
      { new: true, upsert: true, runValidators: true }
    );
    return res.json({ call_id: call.id });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
};

exports.listEnquiries = async (_req, res) => res.json(await InboundEnquiry.find().sort({ createdAt: -1 }).limit(100));
exports.listCalls = async (_req, res) => res.json(await InboundCall.find().sort({ createdAt: -1 }).limit(100));
exports.requiresDograhKey = requiresDograhKey;
