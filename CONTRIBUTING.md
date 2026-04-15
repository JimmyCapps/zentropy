# Contributing to HoneyLLM

## Getting Started

1. Fork the repository
2. Clone your fork: `git clone https://github.com/<your-username>/zentropy.git`
3. Install dependencies: `npm install`
4. Create a branch: `git checkout -b feat/your-feature`

## Development Workflow

1. Make your changes
2. Run type checking: `npm run typecheck`
3. Run unit tests: `npm test`
4. Build the extension: `npm run build`
5. Test in Chrome by loading `dist/` as an unpacked extension
6. Run E2E tests if modifying detection or mitigation logic: `npm run test:e2e`

## Pull Requests

- Keep PRs focused on a single change
- Include tests for new probes, analyzers, or scoring rules
- Update documentation if adding new features
- Use conventional commit messages: `feat:`, `fix:`, `refactor:`, `test:`, `docs:`

## Adding a New Probe

1. Create a new file in `src/probes/` implementing the `Probe` interface from `base-probe.ts`
2. Add corresponding tests in `src/probes/<name>.test.ts`
3. Register the probe in `src/offscreen/probe-runner.ts`
4. Add scoring rules in `src/policy/rules.ts`
5. Update the max score constant in `src/shared/constants.ts`

## Adding a New Behavioral Analyzer

1. Create a new file in `src/analysis/`
2. Add tests in `src/analysis/<name>.test.ts`
3. Wire it into `src/analysis/behavioral-analyzer.ts`
4. Add the flag to `BehavioralFlags` in `src/types/verdict.ts`
5. Add scoring weight in `src/policy/rules.ts`

## Code Style

- TypeScript strict mode — no `any` types
- Immutable patterns — return new objects, don't mutate
- Small files — aim for under 400 lines
- No comments unless explaining a non-obvious "why"
