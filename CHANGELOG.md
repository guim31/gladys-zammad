# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

## [1.0.0] - 2026-10-30

### Added

- Zammad in Gladys: a device for the instance with the open, new, pending,
  escalated and unassigned tickets, the tickets assigned to the agent of the
  token and the tickets created today; one more device per followed group,
  with the same counters.
- Scene triggers "New Zammad ticket" and "Zammad ticket escalated" (past the
  SLA escalation time), filtered by group and priority, with the ticket title,
  number, group, priority, state, customer and address.
- Scene action "Create a Zammad ticket": title, group, text, priority and
  customer e-mail, returning the ticket id, number and address.
- Dashboard widget "Open tickets": the 10 latest open tickets, escalated ones
  in red, with the open and escalated counts, for the instance or one group.
- A refresh interval of 1 to 10 minutes, readings at the next escalation time
  and at midnight, and self-signed certificates on request.
- A "Test the connection" button and a connection status naming the problem.
- Every text in English, French, German and Spanish.

[Unreleased]: https://github.com/guim31/gladys-zammad/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/guim31/gladys-zammad/releases/tag/v1.0.0
