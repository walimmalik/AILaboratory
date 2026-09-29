# 0019: Password sign-in with a session cookie for the web app

- Status: accepted
- Date: 2026-09-29
- Plan: 004 (round 5, question 3)

## Context

The web app needs to know who is using it. Runs locally now and on an internal cluster later; SSO may come when the lab adopts it.

## Options

1. Email and password, exchanged for an HttpOnly session cookie
2. Paste an API token into the browser
3. No sign-in on localhost

## Decision

Option 1. Passwords are stored as scrypt hashes (at least 10 characters). A session token (stored as a SHA-256 hash in `sessions`) lives in an HttpOnly, SameSite=Strict cookie for 30 days. Unknown emails and wrong passwords get the same answer and take the same time. Cookie-authenticated writes must be JSON, which a cross-site form cannot send. Bearer tokens remain for agents and scripts.

## Consequences

The hosted cluster needs no new mechanism, and SSO can later replace the password step while keeping sessions. No login rate limiting yet; add it before exposing the app beyond the lab network.
