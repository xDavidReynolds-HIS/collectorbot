import {
  InvalidStateError,
  UUID
} from '@zerobias-org/types-core-js';
import { Batch } from '@zerobias-org/util-collector';
import { injectable } from 'inversify';
import { Parameters } from '../generated/model/index.js';
import { BaseClient } from '../generated/BaseClient.js';
import {
  CONTAINER_TYPE_MANAGEMENT_GROUP,
  CONTAINER_TYPE_RESOURCE_GROUP,
  CONTAINER_TYPE_SUBSCRIPTION,
  toManagementGroup,
  toResource,
  toResourceGroup,
  toSubscription,
} from './Mappers.js';

@injectable()
export class CollectorMicrosoftAzureAzureresourcegraphImpl extends BaseClient {
  private metadata: any;

  private _jobId?: UUID;

  private _tenantId?: string;

  private previewCount?: number = this.context.previewMode ? this.context.previewCount : undefined;

  get jobId(): UUID {
    if (!this._jobId) {
      this._jobId = this.getJobId();
    }
    return this._jobId;
  }

  get tenantId(): string {
    if (!this._tenantId) {
      throw new InvalidStateError('Tenant ID has not been identified');
    }
    return this._tenantId;
  }

  private async init() {
    try {
      this.metadata = await this.azureresourcegraph.metadata();
    } catch (err) {
      // The ARG module's metadata() is a platform-replaced stub; in direct
      // runs it carries no useful info. Batch tags are optional, so a
      // metadata failure is not fatal.
      this.logger.warn(`Unable to get connection metadata: ${err.message}`);
    }
  }

  private async initBatchForClass<T extends Record<string, any>>(
    className: string,
    groupId?: string
  ): Promise<Batch<T>> {
    const batch: Batch<T> = new Batch<T>(
      className,
      this.platform,
      this.logger,
      this.jobId,
      this.metadata?.tags,
      groupId
    );
    await batch.getId();
    return batch;
  }

  /**
   * ARG has no metadata endpoint that exposes the tenant, so extract the
   * Azure AD tenant ID from the first readable row (VENDOR_PATTERNS:
   * "extract system identifier from first API call"). Containers are
   * probed first (a readable tenant always has at least one subscription),
   * falling back to resources.
   *
   * Returns false when nothing is readable — the service principal has no
   * Reader grant anywhere — in which case there is nothing to collect.
   */
  private async identifyTenant(
    subscriptionIds?: Array<string>,
    managementGroupIds?: Array<string>
  ): Promise<boolean> {
    if (this._tenantId) {
      return true;
    }
    const containerProbe = await this.azureresourcegraph
      .getResourceContainerApi()
      .list(1, undefined, subscriptionIds, managementGroupIds);
    let first: { tenantId?: string } | undefined = containerProbe.items?.[0];
    if (!first) {
      const resourceProbe = await this.azureresourcegraph
        .getResourceApi()
        .list(1, undefined, subscriptionIds, managementGroupIds);
      first = resourceProbe.items?.[0];
    }
    if (first?.tenantId) {
      this._tenantId = first.tenantId;
      this.logger.info(`Identified Azure AD tenant: ${this._tenantId}`);
      return true;
    }
    return false;
  }

  /**
   * GroupId strategy: the complete, independent data set is "everything
   * the connection can read within the requested scope". Tenant-scope
   * runs (no parameters) use the bare tenant ID; scoped runs append the
   * sorted scope so differently-scoped pipelines never delete each
   * other's data. Resource vs container sets are already isolated by
   * class (one suite class per row kind).
   */
  private buildGroupId(parameters?: Parameters): string {
    const parts: string[] = [this.tenantId];
    if (parameters?.subscriptionIds?.length) {
      parts.push(`sub:${[...parameters.subscriptionIds].sort().join('|')}`);
    }
    if (parameters?.managementGroupIds?.length) {
      parts.push(`mg:${[...parameters.managementGroupIds].sort().join('|')}`);
    }
    return parts.join('-');
  }

  private async loadResourceContainers(
    groupId: string,
    subscriptionIds?: Array<string>,
    managementGroupIds?: Array<string>
  ): Promise<void> {
    this.logger.info('Loading resource containers (subscriptions / resource groups / management groups)');
    // One ARG pass, routed into a batch per suite class — the
    // ResourceContainers table mixes all three row kinds.
    const subscriptions = await this.initBatchForClass('AzureSubscription', groupId);
    const resourceGroups = await this.initBatchForClass('AzureResourceGroup', groupId);
    const managementGroups = await this.initBatchForClass('AzureManagementGroup', groupId);
    // ARG caps $top at 1000 — request the maximum page size; paging is
    // cursor-based ($skipToken) and handled by PagedResults.
    const containers = await this.azureresourcegraph
      .getResourceContainerApi()
      .list(1000, undefined, subscriptionIds, managementGroupIds);
    await containers.forEach(async (container) => {
      try {
        switch (container.type?.toLowerCase()) {
          case CONTAINER_TYPE_SUBSCRIPTION:
            await subscriptions.add(toSubscription(container));
            break;
          case CONTAINER_TYPE_RESOURCE_GROUP:
            await resourceGroups.add(toResourceGroup(container));
            break;
          case CONTAINER_TYPE_MANAGEMENT_GROUP:
            await managementGroups.add(toManagementGroup(container));
            break;
          default:
            this.logger.warn(`Unrecognized resource container type '${container.type}' for ${container.id} - skipping`);
        }
      } catch (err) {
        await subscriptions.error(`Failed to process resource container ${container.id}`, err);
      }
    }, undefined, this.previewCount);
    await subscriptions.end();
    await resourceGroups.end();
    await managementGroups.end();
    this.logger.info('Loading resource containers - done');
  }

  private async loadResources(
    groupId: string,
    subscriptionIds?: Array<string>,
    managementGroupIds?: Array<string>
  ): Promise<void> {
    this.logger.info('Loading resources');
    const batch = await this.initBatchForClass('AzureInventoryItem', groupId);
    const resources = await this.azureresourcegraph
      .getResourceApi()
      .list(1000, undefined, subscriptionIds, managementGroupIds);
    await resources.forEach(async (resource) => {
      try {
        await batch.add(toResource(resource));
      } catch (err) {
        await batch.error(`Failed to process resource ${resource.id}`, err);
      }
    }, undefined, this.previewCount);
    await batch.end();
    this.logger.info('Loading resources - done');
  }

  public async run(parameters?: Parameters): Promise<any> {
    await this.init();

    const subscriptionIds = parameters?.subscriptionIds;
    const managementGroupIds = parameters?.managementGroupIds;

    const readable = await this.identifyTenant(subscriptionIds, managementGroupIds);
    if (!readable) {
      // ARG silently returns no rows for unreadable objects; a completely
      // empty tenant-scope response means the service principal has no
      // Reader grant anywhere. Don't run empty batches (no tenant ID to
      // group them under) — surface the condition instead.
      this.logger.warn(
        'Azure Resource Graph returned no readable rows - the service principal '
        + 'likely lacks the Reader role at any subscription or management-group scope. '
        + 'Nothing to collect.'
      );
      return;
    }

    const groupId = this.buildGroupId(parameters);

    // Containers (subscriptions / resource groups) are the parents of
    // resources — collect them first.
    await this.loadResourceContainers(groupId, subscriptionIds, managementGroupIds);
    await this.loadResources(groupId, subscriptionIds, managementGroupIds);
  }
}
