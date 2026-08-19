# @zerobias-org/collectorbot-microsoft-azure-azureresourcegraph

## Description

Collector bot for **Azure Resource Graph** (ARG). Performs tenant-wide Azure
asset inventory by querying the ARG `Resources` and `ResourceContainers`
tables through `@zerobias-org/module-microsoft-azure-azureresourcegraph`
(POST `https://management.azure.com/providers/Microsoft.ResourceGraph/resources`,
api-version `2024-04-01`, cursor paging via `$skipToken`).

## Data Collected

Suite-class collection against `@zerobias-org/schema-microsoft-azure`
(team decision 2026-08-12 — ARG is a query surface over ARM inventory with
no domain objects of its own, so the collector writes the Azure suite
classes directly):

- **AzureInventoryItem** — one per row of the ARG `Resources` table (VMs,
  storage accounts, key vaults, ...). The inherited `assetType` carries the
  ARG `type` column verbatim (e.g. `microsoft.compute/virtualmachines`);
  `subscription` / `resourceGroup` / `resourceProvider` / `resourceType`
  links are populated from the row.
- **AzureSubscription**, **AzureResourceGroup** and
  **AzureManagementGroup** — one per row of the ARG `ResourceContainers`
  table, routed by the row's `type` column. Management-group rows populate
  the hierarchy `parent` link from `properties.details.parent.id`.

## Required Permissions

- Azure RBAC **Reader** role for the service principal, at subscription or
  management-group scope. ARG silently returns no rows for unreadable
  objects; if nothing at all is readable the collector logs a warning and
  collects nothing.

## Configuration

Connection is handled by the module's connection profile (`directoryId`,
`clientId`, `clientSecret`). Optional parameters:

- `subscriptionIds` (optional): limit collection to these subscriptions
- `managementGroupIds` (optional): limit collection to these management groups

Omit both to collect at tenant scope (everything readable).

## GroupId Strategy

The system identifier is the Azure AD tenant ID, extracted from the first
readable row (ARG has no metadata endpoint):

- Tenant scope: `${tenantId}`
- Scoped runs append the sorted scope, e.g. `${tenantId}-sub:<ids>` /
  `${tenantId}-mg:<ids>`, so differently-scoped pipelines never delete
  each other's data.

Row-kind data sets are additionally isolated by class.

## Development

```bash
zbb build        # gradle lifecycle: validate -> generate -> lint -> compile
zbb testDirect   # e2e (skips without a live hub target)
zbb gate         # full gate incl. dataloader validation
```
