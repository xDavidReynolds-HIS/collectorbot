import type {
  AzureInventoryItem,
  AzureManagementGroup,
  AzureResourceGroup,
  AzureSubscription,
  Tag,
} from '@zerobias-org/schema-microsoft-azure-ts';
import { AzureSubscriptionState } from '@zerobias-org/schema-microsoft-azure-ts';
import { CloudProvider, CloudRegion, CloudRegionDef } from '@zerobias-org/types-core-js';
import type { Resource, ResourceContainer } from '@zerobias-org/module-microsoft-azure-azureresourcegraph';

/** ARG `type` values for the three ResourceContainers row kinds. */
export const CONTAINER_TYPE_SUBSCRIPTION = 'microsoft.resources/subscriptions';
export const CONTAINER_TYPE_RESOURCE_GROUP = 'microsoft.resources/subscriptions/resourcegroups';
export const CONTAINER_TYPE_MANAGEMENT_GROUP = 'microsoft.management/managementgroups';

/**
 * Convert the ARG `tags` column ({ key: value }) to the schema Tag document shape.
 */
function toTags(tags?: { [key: string]: string }): Tag[] | undefined {
  if (!tags) {
    return undefined;
  }
  const entries = Object.entries(tags)
    .filter(([, value]) => value !== undefined && value !== null)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => ({ key, value: `${value}` }));
  return entries.length > 0 ? entries : undefined;
}

/**
 * Resolve an ARG `location` code (e.g. `eastus`) to the typed CloudRegion
 * EnumValue (`azure_eastus`). Unknown regions resolve to undefined rather
 * than failing the row.
 */
function toCloudRegion(location?: string): CloudRegionDef | undefined {
  if (!location) {
    return undefined;
  }
  const wanted = `azure_${location.toLowerCase()}`;
  return CloudRegion.values.find((region) => region.value === wanted);
}

/**
 * Map an Azure Resource Graph `Resources` row to the suite
 * `AzureInventoryItem` class.
 *
 * Link values are the ARM IDs of the container objects collected in the
 * same run, so the dataloader can resolve them:
 * - `subscription`   -> `/subscriptions/<subscriptionId>` (= the subscription container row's `id`)
 * - `resourceGroup`  -> the resource-ID prefix up to `/providers/` (= the resource-group container row's `id`)
 * - `resourceProvider` / `resourceType` -> derived from the ARG `type` column;
 *   both targets are `shared: true` suite classes.
 *
 * The ARG `type` column is carried in full by the `resourceType` link.
 * NOT mapped (suite-schema gaps reported on the review thread):
 * `kind` / `managedBy` — they live on the `AzureResource` interface, which
 * `AzureInventoryItem` does not implement; `assetType` — the inherited
 * `InventoryItem` property is the closed `Asset_type` enum (LAPTOP/DESKTOP/
 * .../UNKNOWN), which cannot carry the ARG `type` verbatim.
 */
export function toResource(raw: Resource): AzureInventoryItem {
  const providersIdx = raw.id.toLowerCase().indexOf('/providers/');
  const resourceGroupId = providersIdx > 0 && raw.resourceGroup
    ? raw.id.substring(0, providersIdx)
    : undefined;
  const output: AzureInventoryItem = {
    // Full ARM resource ID — globally unique and stable.
    id: raw.id,
    name: raw.name || raw.id,
    location: raw.location,
    tag: toTags(raw.tags),
    subscription: raw.subscriptionId ? `/subscriptions/${raw.subscriptionId}` : undefined,
    resourceGroup: resourceGroupId,
    resourceProvider: raw.type.split('/')[0],
    resourceType: raw.type,
  };
  return output;
}

/**
 * Map a `ResourceContainers` subscription row to the suite `AzureSubscription`
 * (extends `CloudService`).
 */
export function toSubscription(raw: ResourceContainer): AzureSubscription {
  const output: AzureSubscription = {
    id: raw.id,
    name: raw.name || raw.id,
    provider: CloudProvider.Azure,
    tag: toTags(raw.tags),
  };
  // Subscription state arrives in the untyped ARG `properties` bag as e.g.
  // "Enabled" / "PastDue"; the schema enum wants ALL_CAPS.
  const state = (raw.properties as { state?: string } | undefined)?.state;
  if (state) {
    const mapped = AzureSubscriptionState[
      state.toUpperCase() as keyof typeof AzureSubscriptionState
    ];
    if (mapped) {
      output.state = mapped;
    }
  }
  return output;
}

/**
 * Map a `ResourceContainers` resource-group row to the suite
 * `AzureResourceGroup`. `managedBy` (an AzureResource uniLink) is populated
 * from the untyped `properties` bag when ARM reports the group as managed
 * (e.g. Databricks-managed resource groups).
 */
export function toResourceGroup(raw: ResourceContainer): AzureResourceGroup {
  const managedBy = (raw.properties as { managedBy?: string } | undefined)?.managedBy;
  const output: AzureResourceGroup = {
    id: raw.id,
    name: raw.name || raw.id,
    region: toCloudRegion(raw.location),
    subscription: raw.subscriptionId ? `/subscriptions/${raw.subscriptionId}` : undefined,
    managedBy,
    tag: toTags(raw.tags),
  };
  return output;
}

/**
 * Map a `ResourceContainers` management-group row to the suite
 * `AzureManagementGroup`, populating the hierarchy `parent` link from the
 * ARG `properties.details.parent.id` (same ARM ID namespace as the
 * management-group rows collected in this run, so the dataloader can
 * resolve it). The inverse links (`children`, `subscriptions`) and the
 * `tenant` link are left unmapped — ARG rows carry only the bare tenant
 * GUID, not an AzureTenant ARM ID.
 */
export function toManagementGroup(raw: ResourceContainer): AzureManagementGroup {
  const parentId = (raw.properties as { details?: { parent?: { id?: string } } } | undefined)
    ?.details?.parent?.id;
  const output: AzureManagementGroup = {
    id: raw.id,
    name: raw.name || raw.id,
    parent: parentId,
    tag: toTags(raw.tags),
  };
  return output;
}
