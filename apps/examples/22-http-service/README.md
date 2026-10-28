# Local HTTP service

Run after the package build.

```sh
pnpm --dir apps/examples exec tsx 22-http-service/index.ts
```

The example starts on an ephemeral localhost port, sends document bytes to convert,
inspect and configured-schema extract, then shuts down. It asserts three loads and
one shared-loader disposal. It needs no credentials or live model.

The service accepts JSON with base64 document bytes. It does not accept server
paths or caller-supplied model settings. Use `DOCTURE_SERVE_TOKEN` when binding
outside localhost. Schema/config changes require a restart.
