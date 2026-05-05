# Bot Manifests

Place bot manifests in subdirectories using this convention:

```text
bots/<bot-id>/bot.json
```

Example:

```json
{
  "id": "example-bot",
  "name": "Example Bot",
  "version": "0.1.0",
  "endpoint": "http://127.0.0.1:9000",
  "description": "Optional short description."
}
```

The app exposes discovered manifests through:

```http
GET /api/bots
```

This directory only stores discovery metadata. Bot engines should run as separate services and submit proposed actions through the game API.
