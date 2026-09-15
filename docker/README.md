# Cito UFC API — Docker demo

Run a self-contained UFC data demo in one command. No clone, no install, no
build step.

```bash
docker run --rm -e CITO_API_KEY=your-key citoapi/ufc-api-demo
```

Or with compose:

```bash
echo "CITO_API_KEY=your-key" > .env
docker compose up
```

> **Free API key — 500 calls/month, no credit card:** <https://citoapi.com/signup/>

---

## What it does

On start the container fetches from the Cito UFC API and prints:

- the coverage map (entity counts and freshness)
- the next card, with its full bout list
- that card's odds, where coverage exists
- the current champions
- a live feed health check

Then it exits. It is a demonstration, not a long-running service — nothing to
host, nothing to monitor.

---

## Building locally

From `packages/cito-ufc-kit`:

```bash
docker build -f docker/Dockerfile -t citoapi/ufc-api-demo .
docker run --rm -e CITO_API_KEY=your-key citoapi/ufc-api-demo
```

---

## Notes

- The image is `python:3.12-alpine` and runs as a non-root user.
- The key is passed as an environment variable at runtime and is **not** baked
  into any layer.
- To use the SDK inside the container:

  ```bash
  docker run --rm -it -e CITO_API_KEY=your-key --entrypoint sh citoapi/ufc-api-demo
  # then: python -c "from ufcapi import UFC; print(UFC().next_event().title)"
  ```

---

## License

MIT. Independent demo for the Cito UFC API. Not affiliated with, endorsed by, or
licensed by the UFC, Zuffa, TKO Group or any promotion.
