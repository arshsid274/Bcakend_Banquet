const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const controller = require('../src/controllers/DograhInboundController');
const InboundCall = require('../src/models/InboundCall');
const InboundEnquiry = require('../src/models/InboundEnquiry');

const originalFetch = global.fetch;
const originalUpdate = InboundCall.findOneAndUpdate;
const originalCreate = InboundEnquiry.create;
afterEach(() => {
  global.fetch = originalFetch;
  InboundCall.findOneAndUpdate = originalUpdate;
  InboundEnquiry.create = originalCreate;
});

function response() {
  return {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

test('Dograh inbound envelope looks up the caller and returns initial_context', async () => {
  global.fetch = async (url) => {
    assert.equal(new URL(url).searchParams.get('q'), '9876543210');
    return { ok: true, json: async () => [{ number: '9876543210', name: 'Test', _id: 'booking-1' }] };
  };
  const res = response();
  await controller.preCallContext({ body: { call_inbound: { from_number: '+919876543210' } } }, res);
  assert.equal(res.body.initial_context.customer_found, true);
  assert.equal(res.body.initial_context.booking_id, 'booking-1');
});

test('lookup failure returns fallback in the Dograh context envelope', async () => {
  global.fetch = async () => ({ ok: false, status: 503 });
  const res = response();
  await controller.preCallContext({ body: { caller_number: '9876543210' } }, res);
  assert.deepEqual(res.body, { initial_context: { customer_found: false, lookup_unavailable: true } });
});

for (const encoded of [false, true]) {
  test(`call result accepts ${encoded ? 'rendered JSON strings' : 'objects'}`, async () => {
    let saved;
    InboundCall.findOneAndUpdate = async (filter, update) => {
      assert.deepEqual(filter, { workflowRunId: 'test-run' });
      saved = update;
      return { id: 'call-1' };
    };
    const initial = { caller_number: '9876543210' };
    const gathered = { call_outcome: 'enquiry', summary: 'Test summary' };
    const res = response();
    await controller.saveCallResult({ body: {
      workflow_run_id: 'test-run',
      initial_context: encoded ? JSON.stringify(initial) : initial,
      gathered_context: encoded ? JSON.stringify(gathered) : gathered,
    } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(saved.callerNumber, initial.caller_number);
    assert.equal(saved.summary, gathered.summary);
    assert.deepEqual(saved.gatheredContext, gathered);
  });
}

test('invalid serialized context is rejected before writing', async () => {
  InboundCall.findOneAndUpdate = async () => assert.fail('must not write');
  const res = response();
  await controller.saveCallResult({ body: { workflow_run_id: 'test', gathered_context: '[]' } }, res);
  assert.equal(res.statusCode, 400);
});

test('empty enquiry probe cannot create customer data', async () => {
  global.fetch = async () => assert.fail('must not call booking API');
  const res = response();
  await controller.createEnquiry({ body: {} }, res);
  assert.equal(res.statusCode, 400);
});

test('plain-text hosting failure reports the upstream error instead of hiding it', async () => {
  global.fetch = async () => ({
    ok: false,
    status: 500,
    text: async () => 'A server error has occurred\nFUNCTION_INVOCATION_FAILED',
  });
  const res = response();
  await controller.createEnquiry({ body: {
    name: 'Test', caller_number: '9876543210', event_date: '2026-12-15', guest_count: 100,
  } }, res);
  assert.equal(res.statusCode, 502);
  assert.equal(res.body.upstream_status, 500);
  assert.equal(res.body.provider_error, 'FUNCTION_INVOCATION_FAILED');
  assert.match(res.body.error, /not saved/);
});

for (const [input, expected] of [[undefined, null], ['', null], [' mandala ', 'Mandala']]) {
  test(`enquiry hall ${JSON.stringify(input)} maps to ${JSON.stringify(expected)} and preserves booking ID`, async () => {
    global.fetch = async (_url, options) => {
      const payload = JSON.parse(options.body);
      assert.equal(payload.hall, expected);
      assert.equal(payload.bookingStatus, 'Enquiry');
      return { ok: true, json: async () => ({ message: 'Success', booking: { _id: 'booking-123' } }) };
    };
    InboundEnquiry.create = async (enquiry) => {
      assert.equal(enquiry.crmBookingId, 'booking-123');
      return { ...enquiry, id: 'enquiry-123' };
    };
    const res = response();
    await controller.createEnquiry({ body: {
      name: 'Test', caller_number: '9876543210', event_date: '2026-12-15', guest_count: 100,
      hall_preference: input,
    } }, res);
    assert.equal(res.statusCode, 201);
    assert.equal(res.body.booking_id, 'booking-123');
  });
}

test('unrecognized hall is rejected before contacting the booking service', async () => {
  global.fetch = async () => assert.fail('must not send invalid hall');
  const res = response();
  await controller.createEnquiry({ body: {
    name: 'Test', caller_number: '9876543210', event_date: '2026-12-15', guest_count: 100,
    hall_preference: 'Unknown hall',
  } }, res);
  assert.equal(res.statusCode, 400);
});

const bookingFormEnquiry = {
  name: 'Test', caller_number: '9876543210', event_date: '2026-12-15', guest_count: 100,
};

function acceptBooking(inspect) {
  global.fetch = async (_url, options) => {
    inspect(JSON.parse(options.body));
    return { ok: true, json: async () => ({ booking: { _id: 'booking-123' } }) };
  };
  InboundEnquiry.create = async (enquiry) => ({ ...enquiry, id: 'enquiry-123' });
}

test('booking-form answers reach the CRM payload', async () => {
  let payload;
  acceptBooking((body) => { payload = body; });
  const res = response();
  await controller.createEnquiry({ body: {
    ...bookingFormEnquiry,
    hall_preference: 'Nirvana', rate_plan: 'gold', food_type: 'non veg', time: '19:30',
    whatsapp: '9123456789', room_option: 'both', complimentary_rooms: 2, extra_rooms: 3,
  } }, res);
  assert.equal(res.statusCode, 201);
  assert.equal(payload.ratePlan, 'Gold');
  assert.equal(payload.foodType, 'Non-Veg');
  assert.equal(payload.time, '19:30');
  assert.equal(payload.whatsapp, '9123456789');
  assert.equal(payload.roomOption, 'both');
  assert.equal(payload.complimentaryRooms, 2);
  assert.equal(payload.extraRooms, 3);
});

test('undecided answers are omitted from the payload and flagged for staff', async () => {
  let payload;
  acceptBooking((body) => { payload = body; });
  const res = response();
  await controller.createEnquiry({ body: bookingFormEnquiry }, res);
  assert.equal(res.statusCode, 201);
  // An empty string would fail the CRM enum, so the key must be absent entirely.
  assert.equal('ratePlan' in payload, false);
  assert.equal('roomOption' in payload, false);
  assert.equal('complimentaryRooms' in payload, false);
  assert.equal(payload.foodType, 'Veg');
  assert.equal(payload.whatsapp, bookingFormEnquiry.caller_number);
  assert.match(payload.notes, /Rate plan not yet selected/);
  assert.match(payload.notes, /Start time not yet given/);
});

test('booking-form answers are stored on the enquiry record', async () => {
  let saved;
  global.fetch = async () => ({ ok: true, json: async () => ({ booking: { _id: 'booking-123' } }) });
  InboundEnquiry.create = async (enquiry) => { saved = enquiry; return { ...enquiry, id: 'enquiry-123' }; };
  const res = response();
  await controller.createEnquiry({ body: {
    ...bookingFormEnquiry, rate_plan: 'Platinum', food_type: 'Veg', time: '11:00', extra_rooms: 4,
  } }, res);
  assert.equal(res.statusCode, 201);
  assert.equal(saved.ratePlan, 'Platinum');
  assert.equal(saved.eventTime, '11:00');
  assert.equal(saved.extraRooms, 4);
  assert.equal(saved.whatsappNumber, bookingFormEnquiry.caller_number);
});

for (const [field, value] of [
  ['rate_plan', 'Diamond'], ['food_type', 'Vegan'], ['room_option', 'penthouse'],
]) {
  test(`unrecognized ${field} is rejected before contacting the booking service`, async () => {
    global.fetch = async () => assert.fail(`must not send invalid ${field}`);
    const res = response();
    await controller.createEnquiry({ body: { ...bookingFormEnquiry, [field]: value } }, res);
    assert.equal(res.statusCode, 400);
    assert.match(res.body.error, new RegExp(field));
  });
}
