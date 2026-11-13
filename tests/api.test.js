/**
 * End-to-end contract tests for the Koya clinic booking API.
 * Run with the server already listening (npm start), then: npm test
 */
const BASE = process.env.BASE_URL || 'http://127.0.0.1:4000';
const KEY = process.env.API_KEY || 'koya-secret-key-2026';

let passed = 0;
const failures = [];

function check(name, condition, detail) {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failures.push({ name, detail });
    console.log(`  FAIL  ${name}${detail ? ` -> ${JSON.stringify(detail)}` : ''}`);
  }
}

async function request(method, path, { body, headers = {} } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: res.status, headers: res.headers, data };
}

const auth = (extra = {}) => ({ 'X-API-Key': KEY, ...extra });

function iso(offsetMinutes) {
  return new Date(Date.now() + offsetMinutes * 60 * 1000).toISOString();
}

function makeSlots(count, prefix = 's') {
  return Array.from({ length: count }, (_, i) => ({
    id: `${prefix}${i + 1}`,
    provider: i % 2 === 0 ? 'Dr Ade' : 'Dr Bello',
    start: iso(60 + i * 30),
    end: iso(90 + i * 30),
  }));
}

async function reset(slots) {
  return request('POST', '/reset', { body: { slots }, headers: auth() });
}

async function run() {
  console.log(`Testing ${BASE}\n`);

  // ---------------------------------------------------------------- Level 2
  let res = await request('GET', '/slots');
  check('401 when X-API-Key is missing (level 2)', res.status === 401, res);

  res = await request('GET', '/slots', { headers: { 'X-API-Key': 'wrong-key' } });
  check('401 when X-API-Key is wrong (level 2)', res.status === 401, res);

  res = await request('GET', '/slots', { headers: auth() });
  check('200 with valid X-API-Key', res.status === 200, res);

  // ---------------------------------------------------------------- Level 1
  const slots = makeSlots(8);
  const pastSlot = {
    id: 'past1',
    provider: 'Dr Ade',
    start: iso(-120),
    end: iso(-90),
  };

  res = await reset([...slots, pastSlot]);
  check('POST /reset returns 200', res.status === 200, res);

  res = await request('GET', '/slots', { headers: auth() });
  check('GET /slots returns 200', res.status === 200, res);
  check('GET /slots returns an array', Array.isArray(res.data?.slots), res.data);

  const returnedSlots = res.data?.slots || [];
  const starts = returnedSlots.map((s) => new Date(s.start).getTime());
  check(
    'GET /slots is sorted earliest first',
    starts.every((v, i) => i === 0 || starts[i - 1] <= v),
    starts
  );
  check(
    'GET /slots marks every slot available',
    returnedSlots.every((s) => s.available === true),
    returnedSlots
  );
  check(
    'past slots are also returned',
    returnedSlots.some((s) => s.id === 'past1'),
    returnedSlots.map((s) => s.id)
  );

  res = await request('GET', '/slots?provider=Dr%20Bello', { headers: auth() });
  check(
    'GET /slots?provider= filters by exact provider',
    res.status === 200 && res.data.slots.every((s) => s.provider === 'Dr Bello'),
    res.data
  );

  // ---------------------------------------------------------------- Level 2
  res = await request('POST', '/bookings', { body: {}, headers: auth() });
  check('400 when all fields are missing', res.status === 400 && res.data.error, res);

  res = await request('POST', '/bookings', {
    body: { slot_id: 's1', name: '', email: 'x@example.com' },
    headers: auth(),
  });
  check('400 when name is empty', res.status === 400, res);

  res = await request('POST', '/bookings', {
    body: { slot_id: 's1', name: 'A', email: 'not-an-email' },
    headers: auth(),
  });
  check('400 when email is invalid', res.status === 400, res);

  res = await request('POST', '/bookings', {
    body: { slot_id: 'missing', name: 'A', email: 'a@example.com' },
    headers: auth(),
  });
  check('404 when slot does not exist', res.status === 404, res);

  res = await request('POST', '/bookings', {
    body: { slot_id: 'past1', name: 'A', email: 'past@example.com' },
    headers: auth(),
  });
  check('400 when slot has already started', res.status === 400, res);

  res = await request('POST', '/bookings', {
    body: { slot_id: 's1', name: '  Ada Obi  ', email: '  Ada@Example.COM  ' },
    headers: auth(),
  });
  check('201 creates a confirmed booking', res.status === 201 && res.data.status === 'confirmed', res);
  check('name is trimmed', res.data?.name === 'Ada Obi', res.data);
  check('email is trimmed and lower-cased', res.data?.email === 'ada@example.com', res.data);
  const firstBooking = res.data;

  res = await request('GET', `/bookings/${firstBooking.id}`, { headers: auth() });
  check('GET /bookings/:id returns the booking', res.status === 200 && res.data.id === firstBooking.id, res);

  res = await request('GET', '/bookings/does-not-exist', { headers: auth() });
  check('GET /bookings/:id 404 for unknown id', res.status === 404, res);

  // ---------------------------------------------------------------- Level 3
  res = await request('POST', '/bookings', {
    body: { slot_id: 's1', name: 'Other Person', email: 'other@example.com' },
    headers: auth(),
  });
  check('409 when the slot is already booked', res.status === 409, res);

  res = await request('GET', '/slots', { headers: auth() });
  check(
    'booked slot is marked unavailable',
    res.data.slots.find((s) => s.id === 's1')?.available === false,
    res.data.slots.find((s) => s.id === 's1')
  );

  res = await request('DELETE', `/bookings/${firstBooking.id}`, { headers: auth() });
  check(
    'DELETE cancels the booking',
    res.status === 200 && res.data.status === 'cancelled',
    res
  );

  res = await request('DELETE', `/bookings/${firstBooking.id}`, { headers: auth() });
  check('409 when cancelling twice', res.status === 409, res);

  res = await request('DELETE', '/bookings/nope', { headers: auth() });
  check('404 when cancelling an unknown booking', res.status === 404, res);

  res = await request('GET', '/slots', { headers: auth() });
  check(
    'cancelled booking frees the slot',
    res.data.slots.find((s) => s.id === 's1')?.available === true,
    res.data.slots.find((s) => s.id === 's1')
  );

  res = await request('POST', '/bookings', {
    body: { slot_id: 's1', name: 'Re Booker', email: 'rebook@example.com' },
    headers: auth(),
  });
  check('cancelled slot can be booked again', res.status === 201, res);

  // Concurrent booking of one slot: exactly one winner.
  res = await reset([{ id: 'race', provider: 'Dr Ade', start: iso(120), end: iso(150) }]);
  const raceAttempts = await Promise.all(
    Array.from({ length: 10 }, (_, i) =>
      request('POST', '/bookings', {
        body: { slot_id: 'race', name: `Racer ${i}`, email: `race${i}@example.com` },
        headers: auth(),
      })
    )
  );
  const winners = raceAttempts.filter((r) => r.status === 201);
  const conflicts = raceAttempts.filter((r) => r.status === 409);
  check('exactly one of 10 concurrent bookings wins', winners.length === 1, {
    winners: winners.length,
    conflicts: conflicts.length,
    statuses: raceAttempts.map((r) => r.status),
  });
  check('the other concurrent bookings get 409', conflicts.length === 9, {
    statuses: raceAttempts.map((r) => r.status),
  });

  // ---------------------------------------------------------------- Level 4
  res = await reset(makeSlots(6));
  const idemHeaders = auth({ 'Idempotency-Key': 'idem-key-1' });
  const idemBody = { slot_id: 's2', name: 'Idem User', email: 'idem@example.com' };

  res = await request('POST', '/bookings', { body: idemBody, headers: idemHeaders });
  check('first idempotent request returns 201', res.status === 201, res);
  const idemBooking = res.data;

  res = await request('POST', '/bookings', { body: idemBody, headers: idemHeaders });
  check(
    'retry with same key + body returns the same booking',
    res.status === 201 && res.data.id === idemBooking.id,
    res
  );

  res = await request('POST', '/bookings', {
    body: { ...idemBody, slot_id: 's3' },
    headers: idemHeaders,
  });
  check('same key with a different body returns 422', res.status === 422, res);

  // Pagination: 4 bookings for one person, page size 2.
  res = await reset(makeSlots(6));
  const pageEmail = 'pager@example.com';
  const created = [];
  for (const id of ['s1', 's2', 's3', 's4']) {
    const r = await request('POST', '/bookings', {
      body: { slot_id: id, name: 'Pager', email: pageEmail },
      headers: auth(),
    });
    if (r.status === 201) created.push(r.data);
  }
  check('created 4 bookings for pagination', created.length === 4, created.length);

  res = await request('GET', '/bookings?email=PAGER@example.com&limit=2', { headers: auth() });
  const page1 = res.data?.bookings || [];
  check(
    'first page respects limit and returns next_cursor',
    res.status === 200 && page1.length === 2 && typeof res.data.next_cursor === 'string',
    res.data
  );

  res = await request(
    'GET',
    `/bookings?email=${encodeURIComponent(pageEmail)}&limit=2&cursor=${encodeURIComponent(
      res.data.next_cursor
    )}`,
    { headers: auth() }
  );
  const page2 = res.data?.bookings || [];
  check(
    'second page returns the remaining bookings and null next_cursor',
    res.status === 200 && page2.length === 2 && res.data.next_cursor === null,
    res.data
  );
  const ids = [...page1, ...page2].map((b) => b.id);
  check('pagination returns every booking exactly once', new Set(ids).size === 4, ids);
  check(
    'pagination is oldest first',
    [...page1, ...page2].every((b, i, arr) => i === 0 || new Date(arr[i - 1].created_at) <= new Date(b.created_at)),
    ids
  );

  res = await request('GET', `/bookings?email=${pageEmail}&limit=0`, { headers: auth() });
  check('limit=0 returns 400', res.status === 400, res);
  res = await request('GET', `/bookings?email=${pageEmail}&limit=51`, { headers: auth() });
  check('limit=51 returns 400', res.status === 400, res);
  res = await request('GET', `/bookings?email=${pageEmail}&limit=abc`, { headers: auth() });
  check('non-numeric limit returns 400', res.status === 400, res);

  // ---------------------------------------------------------------- Level 5
  res = await reset(makeSlots(4));
  const spamEmail = 'spam@example.com';
  const spamStatuses = [];
  for (let i = 0; i < 5; i += 1) {
    const r = await request('POST', '/bookings', {
      body: { slot_id: 'does-not-exist', name: 'Spam', email: spamEmail },
      headers: auth(),
    });
    spamStatuses.push(r.status);
  }
  check('first 5 failed attempts are accepted (404)', spamStatuses.every((s) => s === 404), spamStatuses);

  res = await request('POST', '/bookings', {
    body: { slot_id: 's1', name: 'Spam', email: spamEmail },
    headers: auth(),
  });
  const retryAfter = Number(res.headers.get('retry-after'));
  check('6th attempt returns 429', res.status === 429, res);
  check(
    '429 includes a whole-second Retry-After header',
    Number.isInteger(retryAfter) && retryAfter >= 1,
    res.headers.get('retry-after')
  );

  res = await request('POST', '/bookings', {
    body: { slot_id: 's1', name: 'Other', email: 'innocent@example.com' },
    headers: auth(),
  });
  check('other emails are unaffected by the limit', res.status === 201, res);

  // ---------------------------------------------------------------- Report
  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length > 0) {
    console.log('\nFailures:');
    failures.forEach((f) => console.log(` - ${f.name}: ${JSON.stringify(f.detail)}`));
    process.exitCode = 1;
  }
}

run().catch((err) => {
  console.error('Test run crashed:', err);
  process.exitCode = 1;
});
