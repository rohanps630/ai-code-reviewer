# Security

## Reporting a vulnerability

If you find a security issue, please email rohanps@codenforge.com instead of opening a public issue. I'll respond within 5 business days.

## Scope

This is a personal portfolio project. Security expectations are:

- **In scope**: authentication bypass, SSRF, prompt injection that exposes data, secret leaks, code execution outside the E2B sandbox
- **Out of scope**: DoS, rate limit bypass, social engineering, anything requiring physical access

## Known design constraints

- The agent receives untrusted content from public repos. Prompt injection defenses are applied (delimiters, system reminders, output validation) but cannot be assumed bulletproof. Do not connect repos containing secrets you don't want surfaced in agent outputs.
- Code execution happens inside E2B sandboxes. Do not pass production credentials to any tool.

## What this project doesn't do

- No multi-tenant isolation guarantees beyond Supabase row-level security
- No SOC2 / ISO claims
- No audit logging beyond Langfuse traces
