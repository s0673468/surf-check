# Surf Property/Fuzz Suite

The Surf repo intentionally has no build step and no test dependencies. The property layer therefore uses deterministic seeded generators in `node:test`.

## Profiles

```bash
npm run test:property
npm run test:property:deep
```

The default CI profile runs `SURF_PROPERTY_EXAMPLES=80`. The deep profile runs 1000 generated examples. To reproduce or expand a failure:

```bash
SURF_PROPERTY_EXAMPLES=1000 node --test tests/property/fuzz.mjs
SURF_PROPERTY_EXAMPLES=1 SURF_PROPERTY_SEED=<seed-from-failure> node --test tests/property/fuzz.mjs
```

## Extending

Add generators beside the invariant they support, keep fixtures synthetic, and prefer testing runtime helpers through the same classic-script loader used by `tests/smoke.mjs`.
