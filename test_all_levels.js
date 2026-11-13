const assert = require('assert');

const BASE_URL = 'http://localhost:4000';
const API_KEY = 'koya-secret-key-2026';

async function req(path, options = {}) {
  const headers = Object.assign({}, options.headers);
  if (!('X-API-Key' in headers) && !('x-api-key' in headers) && options.skipAuth !== true) {
    headers['X-API-Key'] = API_KEY;
  }
  if (options.body && typeof options.body === 'object' && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(`${BASE_URL}${path}`, {
    method: options.method || 'GET',
    headers: headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  let data = null;
  const text = await res.text();
  try {
    data = JSON.parse(text);
  } catch (e) {
    data = text;
  }

  return { status: res.status, headers: res.headers, body: data };
}

async function runTests() {
  console.log('=== STARTING TEST SUITE FOR LEVELS 1 - 5 ===\n');
  let passed = 0;
  let failed = 0;

  function test(name, fn) {
    return async () => {
      try {
        await fn();
        console.log(`[PASS] ${name}`);
        passed++;
      } catch (err) {
        console.error(`[FAIL] ${name}: ${err.message}`);
        console.error(err);
        failed++;
      }
    };
  }

  const future1 = new Date(Date.now() + 86400000).toISOString();
  const future2 = new Date(Date.now() + 90000000).toISOString();
  const future3 = new Date(Date.now() + 93600000).toISOString();
  const future4 = new Date(Date.now() + 97200000).toISOString();
  const future5 = new Date(Date.now() + 100800000).toISOString();
  const future6 = new Date(Date.now() + 104400000).toISOString();
  const pastStart = new Date(Date.now() - 3600000).toISOString();
  const pastEnd = new Date(Date.now() - 1800000).toISOString();

  const initialSlots = [
    { id: 's_past', provider: 'Dr Past', start: pastStart, end: pastEnd },
    { id: 's1', provider: 'Dr Ade', start: future1, end: future2 },
    { id: 's2', provider: 'Dr Ade', start: future2, end: future3 },
    { id: 's3', provider: 'Dr Bob', start: future3, end: future4 },
    { id: 's4', provider: 'Dr Bob', start: future4, end: future5 },
    { id: 's5', provider: 'Dr Chi', start: future5, end: future6 },
  ];

  // 1. AUTH TESTS (LEVEL 2)
  await test('Auth: Missing X-API-Key returns 401', async () => {
    const res = await req('/slots', { skipAuth: true });
    assert.strictEqual(res.status, 401);
    assert.ok(res.body.error, 'Should have error message');
  })();

  await test('Auth: Wrong X-API-Key returns 401', async () => {
    const res = await req('/slots', { headers: { 'X-API-Key': 'wrong-key' } });
    assert.strictEqual(res.status, 401);
    assert.ok(res.body.error, 'Should have error message');
  })();

  // 2. LEVEL 1: Reset, List, Book, Lookup
  await test('Level 1: POST /reset clears and resets slots', async () => {
    const res = await req('/reset', {
      method: 'POST',
      body: { slots: initialSlots }
    });
    assert.strictEqual(res.status, 200);
  })();

  await test('Level 1: GET /slots returns all slots sorted earliest first', async () => {
    const res = await req('/slots');
    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.body.slots));
    assert.strictEqual(res.body.slots.length, 6);
    assert.strictEqual(res.body.slots[0].id, 's_past');
    assert.strictEqual(res.body.slots[0].available, true);
  })();

  await test('Level 1: GET /slots?provider=Dr Ade filters correctly', async () => {
    const res = await req('/slots?provider=Dr%20Ade');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.slots.length, 2);
    assert.ok(res.body.slots.every(s => s.provider === 'Dr Ade'));
  })();

  let booking1 = null;
  await test('Level 1: POST /bookings books a slot and returns 201 confirmed', async () => {
    const res = await req('/bookings', {
      method: 'POST',
      body: { slot_id: 's1', name: ' Ada Obi ', email: ' ADA@EXAMPLE.COM ' }
    });
    assert.strictEqual(res.status, 201);
    assert.ok(res.body.id);
    assert.strictEqual(res.body.slot_id, 's1');
    assert.strictEqual(res.body.name, 'Ada Obi');
    assert.strictEqual(res.body.email, 'ada@example.com');
    assert.strictEqual(res.body.status, 'confirmed');
    assert.ok(res.body.created_at);
    booking1 = res.body;
  })();

  await test('Level 1: GET /slots now shows slot s1 as unavailable', async () => {
    const res = await req('/slots');
    const s1 = res.body.slots.find(s => s.id === 's1');
    assert.strictEqual(s1.available, false);
  })();

  await test('Level 1: GET /bookings/:id returns booking details', async () => {
    const res = await req(`/bookings/${booking1.id}`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.id, booking1.id);
    assert.strictEqual(res.body.slot_id, 's1');
    assert.strictEqual(res.body.status, 'confirmed');
  })();

  await test('Level 1: GET /bookings/:id with unknown id returns 404', async () => {
    const res = await req('/bookings/non-existent-id');
    assert.strictEqual(res.status, 404);
    assert.ok(res.body.error);
  })();

  // 3. LEVEL 2: Validations
  await test('Level 2: POST /bookings missing slot_id returns 400', async () => {
    const res = await req('/bookings', {
      method: 'POST',
      body: { name: 'Ada', email: 'ada@example.com' }
    });
    assert.strictEqual(res.status, 400);
    assert.ok(res.body.error);
  })();

  await test('Level 2: POST /bookings missing name returns 400', async () => {
    const res = await req('/bookings', {
      method: 'POST',
      body: { slot_id: 's2', email: 'ada@example.com' }
    });
    assert.strictEqual(res.status, 400);
    assert.ok(res.body.error);
  })();

  await test('Level 2: POST /bookings invalid email returns 400', async () => {
    const res = await req('/bookings', {
      method: 'POST',
      body: { slot_id: 's2', name: 'Ada', email: 'not-an-email' }
    });
    assert.strictEqual(res.status, 400);
    assert.ok(res.body.error);
  })();

  await test('Level 2: POST /bookings non-existent slot returns 404', async () => {
    const res = await req('/bookings', {
      method: 'POST',
      body: { slot_id: 's_ghost', name: 'Ada', email: 'ada@example.com' }
    });
    assert.strictEqual(res.status, 404);
    assert.ok(res.body.error);
  })();

  await test('Level 2: POST /bookings slot already started returns 400', async () => {
    const res = await req('/bookings', {
      method: 'POST',
      body: { slot_id: 's_past', name: 'Ada', email: 'ada@example.com' }
    });
    assert.strictEqual(res.status, 400);
    assert.ok(res.body.error);
  })();

  // 4. LEVEL 3: Conflict, Concurrency, Cancellation
  await test('Level 3: Booking already confirmed slot returns 409', async () => {
    const res = await req('/bookings', {
      method: 'POST',
      body: { slot_id: 's1', name: 'Bob', email: 'bob@example.com' }
    });
    assert.strictEqual(res.status, 409);
    assert.ok(res.body.error);
  })();

  await test('Level 3: Concurrency - 20 simultaneous bookings for slot s2', async () => {
    const promises = [];
    for (let i = 0; i < 20; i++) {
      promises.push(
        req('/bookings', {
          method: 'POST',
          body: { slot_id: 's2', name: `User ${i}`, email: `user${i}@example.com` }
        })
      );
    }
    const results = await Promise.all(promises);
    const successes = results.filter(r => r.status === 201);
    const conflicts = results.filter(r => r.status === 409);

    assert.strictEqual(successes.length, 1, 'Exactly one concurrent booking must succeed');
    assert.strictEqual(conflicts.length, 19, 'All other concurrent bookings must get 409');
  })();

  await test('Level 3: DELETE /bookings/:id cancels booking and frees slot', async () => {
    const res = await req(`/bookings/${booking1.id}`, { method: 'DELETE' });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.status, 'cancelled');

    // Slot s1 is now free
    const slotsRes = await req('/slots');
    const s1 = slotsRes.body.slots.find(s => s.id === 's1');
    assert.strictEqual(s1.available, true);
  })();

  await test('Level 3: Slot can be rebooked after cancellation', async () => {
    const res = await req('/bookings', {
      method: 'POST',
      body: { slot_id: 's1', name: 'Charlie', email: 'charlie@example.com' }
    });
    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.body.slot_id, 's1');
    assert.strictEqual(res.body.status, 'confirmed');

    // And cancelling charlie's booking works too without index collisions
    const cancelRes = await req(`/bookings/${res.body.id}`, { method: 'DELETE' });
    assert.strictEqual(cancelRes.status, 200);
    assert.strictEqual(cancelRes.body.status, 'cancelled');
  })();

  await test('Level 3: Cancelling already cancelled booking returns 409', async () => {
    const res = await req(`/bookings/${booking1.id}`, { method: 'DELETE' });
    assert.strictEqual(res.status, 409);
    assert.ok(res.body.error);
  })();

  // 5. LEVEL 4: Idempotency & Cursor Pagination
  await test('Level 4: Idempotency-Key same body returns same booking without duplicate', async () => {
    const body = { slot_id: 's3', name: 'Diana', email: 'diana@example.com' };
    const res1 = await req('/bookings', {
      method: 'POST',
      headers: { 'Idempotency-Key': 'idem-100' },
      body: body
    });
    assert.strictEqual(res1.status, 201);

    // Retry exact same
    const res2 = await req('/bookings', {
      method: 'POST',
      headers: { 'Idempotency-Key': 'idem-100' },
      body: body
    });
    assert.strictEqual(res2.status, 201);
    assert.strictEqual(res2.body.id, res1.body.id);
  })();

  await test('Level 4: Idempotency-Key reused with different body returns 422', async () => {
    const res = await req('/bookings', {
      method: 'POST',
      headers: { 'Idempotency-Key': 'idem-100' },
      body: { slot_id: 's4', name: 'Different', email: 'diff@example.com' }
    });
    assert.strictEqual(res.status, 422);
    assert.ok(res.body.error);
  })();

  await test('Level 4: GET /bookings pagination and limits', async () => {
    // Reset and create 5 bookings for pat@example.com
    await req('/reset', { method: 'POST', body: { slots: initialSlots } });
    const email = 'pat@example.com';
    await req('/bookings', { method: 'POST', body: { slot_id: 's1', name: 'Pat', email } });
    await req('/bookings', { method: 'POST', body: { slot_id: 's2', name: 'Pat', email } });
    await req('/bookings', { method: 'POST', body: { slot_id: 's3', name: 'Pat', email } });

    // Invalid limit returns 400
    const invLimit = await req(`/bookings?email=${email}&limit=abc`);
    assert.strictEqual(invLimit.status, 400);

    const zeroLimit = await req(`/bookings?email=${email}&limit=0`);
    assert.strictEqual(zeroLimit.status, 400);

    const overLimit = await req(`/bookings?email=${email}&limit=51`);
    assert.strictEqual(overLimit.status, 400);

    // Page 1: limit 2
    const page1 = await req(`/bookings?email=${email}&limit=2`);
    assert.strictEqual(page1.status, 200);
    assert.strictEqual(page1.body.bookings.length, 2);
    assert.ok(page1.body.next_cursor);

    // Page 2: with cursor
    const page2 = await req(`/bookings?email=${email}&limit=2&cursor=${page1.body.next_cursor}`);
    assert.strictEqual(page2.status, 200);
    assert.strictEqual(page2.body.bookings.length, 1);
    assert.strictEqual(page2.body.next_cursor, null, 'Last page must have next_cursor: null');
  })();

  // 6. LEVEL 5: Rate Limiting
  await test('Level 5: Rate limit 5 attempts per minute per email, 6th returns 429 with Retry-After', async () => {
    // Reset database to clear state
    await req('/reset', { method: 'POST', body: { slots: initialSlots } });

    const spamEmail = 'spammer@example.com';
    // 5 attempts (failed or successful)
    for (let i = 0; i < 5; i++) {
      const res = await req('/bookings', {
        method: 'POST',
        body: { slot_id: 'non-existent', name: 'Spam', email: spamEmail }
      });
      assert.strictEqual(res.status, 404, `Attempt ${i+1} should fail normally with 404`);
    }

    // 6th attempt should be blocked with 429
    const res6 = await req('/bookings', {
      method: 'POST',
      body: { slot_id: 's1', name: 'Spam', email: spamEmail }
    });
    assert.strictEqual(res6.status, 429, '6th attempt must be 429');
    assert.ok(res6.body.error);
    const retryAfter = res6.headers.get('retry-after');
    assert.ok(retryAfter, 'Retry-After header must be present');
    assert.ok(parseInt(retryAfter, 10) >= 1, 'Retry-After must be positive integer');

    // Other emails are unaffected
    const innocentRes = await req('/bookings', {
      method: 'POST',
      body: { slot_id: 's1', name: 'Innocent', email: 'innocent@example.com' }
    });
    assert.strictEqual(innocentRes.status, 201, 'Other emails should not be rate limited');
  })();

  console.log(`\n=== RESULTS: ${passed} PASSED, ${failed} FAILED ===`);
  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(e => {
  console.error('Test runner fatal error:', e);
  process.exit(1);
});

