---
name: web-builder-production-canary
description: Run real website/Shopify canary tasks and produce verified artifact packs with screenshots, hashes, latency, capability status, and escalation evidence before production claims or public posting.
---

# Web-Builder Production Canary

Real tasks are the release proof. A canary never turns a generated preview into
a Shopify theme claim without the platform compiler and Theme Check gates.

## Required Artifact Pack

For every case, store:

- sanitized brief and prompt hash;
- route and adapter (`web`, `envelope`, or `base`);
- raw model output;
- canonical spec JSON;
- rendered HTML/CSS preview;
- browser screenshot and browser/tool version, or an explicit blocked status;
- deterministic score, SOP/human-systems result, repairs, latency, and peak memory;
- capability status and escalation information;
- SHA-256 hashes for all shipped artifacts.

## Canary Mix

- Standard website brief.
- Shopify storefront brief using supported theme concepts.
- Unique visual brief with a new combination of known primitives.
- Accessibility/security stress brief.
- Unsupported payment/app/metafield request proving explicit escalation.

## Gates

- Supported web cases parse, render, score, and pass the SOP/human-systems gate.
- Shopify cases state artifact scope honestly; full theme support additionally
  requires valid theme structure, Liquid/schema checks, Theme Check, and browser proof.
- Unsupported features never receive a confident fabricated implementation.
- Screenshots are taken from the actual generated artifact, not a hand-made mock.
- Canary results are reproducible from the manifest and recorded in `AGENT_NOTES`.

## Posting Rule

Prepare the public-safe artifact pack locally first. Do not post externally until
the user supplies the destination/account and approves the exact text/images.
