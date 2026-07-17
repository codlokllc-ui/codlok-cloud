# Stage 0 Baseline Freeze

Status: frozen on 2026-07-17.

The baseline contains nine stable modules: Auth, Organizations, Configuration,
Mail, Storage, Pay, Verify, Notifications and SMS.

Acceptance evidence:

- 543 module and integration tests pass.
- TypeScript passes without emit.
- ESLint passes without warnings.
- The full Next.js production build passes.
- Render staging runs from the permanent GitHub repository.
- Secrets, local databases and generated screenshots are excluded from source.

The preview-only authentication bypass is opt-in through
`NEXT_PUBLIC_CODELOK_PREVIEW_BYPASS_AUTH=true`. Authentication is required when
the variable is absent.

Any change to an existing public module contract now requires a versioned
decision record and regression evidence.
