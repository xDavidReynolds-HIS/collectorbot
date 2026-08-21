# Azure Resource Graph Collector - Parameters Guide

This collector runs at tenant scope by default and collects every Azure
resource and resource container the connected service principal can read.
Both parameters are optional and only needed to narrow the scope.

## Parameters

### `subscriptionIds` (optional)

**Description:** Limits collection to the listed Azure subscriptions.

**How to find:** In the Azure Portal, open **Subscriptions** — the
Subscription ID column shows the GUID for each subscription
(e.g. `00000000-0000-0000-0000-000000000000`).

**Default:** All subscriptions readable by the service principal.

### `managementGroupIds` (optional)

**Description:** Limits collection to the listed Azure management groups
(including their descendant subscriptions).

**How to find:** In the Azure Portal, open **Management groups** — use the
management group **ID** (not its display name).

**Default:** Not applied.

## Example Configuration

```json
{
  "subscriptionIds": [
    "11111111-2222-3333-4444-555555555555"
  ]
}
```

Collect everything (tenant scope): configure the connection and leave the
parameters empty:

```json
{}
```
