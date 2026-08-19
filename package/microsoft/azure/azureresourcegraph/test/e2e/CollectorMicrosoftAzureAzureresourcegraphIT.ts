import { getClient } from '@zerobias-com/hub-client';
import 'reflect-metadata';
import { container } from '../../generated/index.js';

/**
 * E2E smoke test — runs the collector against a real hub target.
 *
 * Requires a live environment (hub + a connected Azure Resource Graph
 * target with a service principal holding the Reader role). Without one
 * the test SKIPS rather than fails, so CI and credential-less checkouts
 * stay green.
 */
describe('CollectorMicrosoftAzureAzureresourcegraphIT', function () {
  let client;
  it('Should run the collector', async function () {
    if (!process.env.TARGET_ID && !process.env.HUB_TARGET_ID) {
      // No live hub target configured — skip (no-live-tenant guard).
      this.skip();
    }
    client = await getClient(container);
    await client.run();
  });
});
