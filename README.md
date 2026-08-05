# T3 Code GitHub plugin

This sample is based on upstream GitHub Actions work from PR #5325 and durable
GitHub waitpoints from PR #5003. It owns GitHub authentication, check polling,
PR wait state, and external links. T3 receives bounded check snapshots and
explicit thread-delivery requests.

The package is intentionally independent from T3 core and exercises external
API access, lifecycle events, thread reads/dispatch, and declarative panels.
