import { parseAllDocuments } from "yaml";
import { normalizePath } from "./filesystem.js";
import { namespace } from "./clusterState.js";

const CLUSTER_SCOPED_RESOURCES = new Set(["namespaces", "nodes", "storageclasses"]);
const API_VERSION_BY_KIND = {
  ConfigMap: "v1",
  Deployment: "apps/v1",
  Ingress: "networking.k8s.io/v1",
  Namespace: "v1",
  NetworkPolicy: "networking.k8s.io/v1",
  PersistentVolumeClaim: "v1",
  Pod: "v1",
  Role: "rbac.authorization.k8s.io/v1",
  RoleBinding: "rbac.authorization.k8s.io/v1",
  Secret: "v1",
  Service: "v1",
};

export function runKubectl({ args, cluster, files, cwd, context }) {
  const nextCluster = structuredClone(cluster);
  const command = args[0];
  const namespaceName = getNamespace(args, "default");

  if (args.join(" ") === "config current-context") {
    return ok(nextCluster.currentContext, nextCluster, files, cwd, context);
  }

  if (args[0] === "config" && args[1] === "use-context") {
    const nextContext = args[2];
    if (!nextContext) return ok("error: context name is required", nextCluster, files, cwd, context);
    if (!(nextCluster.contexts ?? []).includes(nextContext)) {
      return ok(`error: no context exists with the name: "${nextContext}"`, nextCluster, files, cwd, context);
    }
    nextCluster.currentContext = nextContext;
    return ok(
      `Switched to context "${nextCluster.currentContext}".`,
      nextCluster,
      files,
      cwd,
      nextCluster.currentContext,
    );
  }

  if (command === "get") return getResource(args, nextCluster, files, cwd, context);
  if (command === "describe") return describeResource(args, nextCluster, files, cwd, context);
  if (command === "create") return createResource(args, nextCluster, files, cwd, context, namespaceName);
  if (command === "run") return runPod(args, nextCluster, files, cwd, context, namespaceName);
  if (command === "apply") return applyManifest(args, nextCluster, files, cwd, context);
  if (command === "delete") return deleteResource(args, nextCluster, files, cwd, context, namespaceName);
  if (command === "scale") return scaleResource(args, nextCluster, files, cwd, context, namespaceName);
  if (command === "set" && args[1] === "image") return setImage(args, nextCluster, files, cwd, context, namespaceName);
  if (command === "rollout") return rolloutStatus(args, nextCluster, files, cwd, context, namespaceName);
  if (command === "logs") return logsFor(args, nextCluster, files, cwd, context, namespaceName);
  if (command === "top") return topResource(args, nextCluster, files, cwd, context);
  if (command === "cordon" || command === "uncordon") {
    return setNodeSchedulable(args, nextCluster, files, cwd, context, command === "uncordon");
  }
  if (command === "drain") return drainNode(args, nextCluster, files, cwd, context);

  return ok(`kubectl ${args.join(" ")} is not implemented in this simulator`, nextCluster, files, cwd, context);
}

function getResource(args, cluster, files, cwd, context) {
  const target = parseResourceTarget(args, 1);
  if (target.error) return ok(target.error, cluster, files, cwd, context);
  const resource = target.kind;
  const allNamespaces = args.includes("-A") || args.includes("--all-namespaces");
  const ns = getNamespace(args, "default");

  if (resource === "namespaces") {
    if (target.name) {
      const nsItem = cluster.namespaces[target.name];
      if (!nsItem) return ok(`Error from server (NotFound): namespaces "${target.name}" not found`, cluster, files, cwd, context);
      return ok(table(["NAME", "STATUS"], [[nsItem.name, "Active"]]), cluster, files, cwd, context);
    }
    return ok(
      table(["NAME", "STATUS"], Object.keys(cluster.namespaces).map((name) => [name, "Active"])),
      cluster,
      files,
      cwd,
      context,
    );
  }

  if (resource === "nodes") {
    if (target.name) {
      const node = cluster.nodes[target.name];
      if (!node) return ok(`Error from server (NotFound): nodes "${target.name}" not found`, cluster, files, cwd, context);
      return ok(table(["NAME", "STATUS", "ROLES", "VERSION"], [[node.name, node.status, node.role, node.version ?? "v1.33.1"]]), cluster, files, cwd, context);
    }
    return ok(
      table(
        ["NAME", "STATUS", "ROLES", "VERSION"],
        Object.values(cluster.nodes).map((node) => [
          node.name,
          `${node.status}${node.schedulable === false ? ",SchedulingDisabled" : ""}`,
          node.role,
          node.version ?? "v1.33.1",
        ]),
      ),
      cluster,
      files,
      cwd,
      context,
    );
  }

  if (resource === "storageclasses") {
    if (target.name) {
      const storageClass = cluster.storageClasses?.[target.name];
      if (!storageClass) return ok(`Error from server (NotFound): storageclasses.storage.k8s.io "${target.name}" not found`, cluster, files, cwd, context);
      return ok(table(["NAME", "PROVISIONER", "DEFAULT"], [[storageClass.name, storageClass.provisioner, storageClass.default ? "true" : "false"]]), cluster, files, cwd, context);
    }
    return ok(
      table(
        ["NAME", "PROVISIONER", "DEFAULT"],
        Object.values(cluster.storageClasses ?? {}).map((item) => [
          item.name,
          item.provisioner,
          item.default ? "true" : "false",
        ]),
      ),
      cluster,
      files,
      cwd,
      context,
    );
  }

  const namespaceCheck = requireNamespaceForResource(cluster, ns, resource, allNamespaces);
  if (!namespaceCheck.ok) return ok(namespaceCheck.message, cluster, files, cwd, context);

  const spaces = allNamespaces ? Object.values(cluster.namespaces) : [namespaceCheck.space];
  const rows = [];
  for (const space of spaces) {
    const collection = collectionFor(space, resource);
    if (!collection) return ok(unknownResource(args[1]), cluster, files, cwd, context);
    if (target.name) {
      const item = collection[target.name];
      if (item) rows.push(allNamespaces ? [space.name, item.name, displayStatus(item)] : [item.name, displayStatus(item)]);
      continue;
    }
    for (const item of Object.values(collection)) {
      rows.push(allNamespaces ? [space.name, item.name, displayStatus(item)] : [item.name, displayStatus(item)]);
    }
  }

  if (target.name && rows.length === 0) return ok(notFound(resource, target.name), cluster, files, cwd, context);
  return ok(table(allNamespaces ? ["NAMESPACE", "NAME", "STATUS"] : ["NAME", "STATUS"], rows), cluster, files, cwd, context);
}

function describeResource(args, cluster, files, cwd, context) {
  const target = parseResourceTarget(args, 1);
  if (target.error) return ok(target.error, cluster, files, cwd, context);
  const resource = target.kind;
  const name = target.name;
  const ns = getNamespace(args, "default");
  if (CLUSTER_SCOPED_RESOURCES.has(normalizeResource(resource))) {
    const collection = clusterCollectionFor(cluster, resource);
    if (!collection) return ok(unknownResource(args[1]), cluster, files, cwd, context);
    const item = collection[name];
    if (!item) return ok(notFound(resource, name), cluster, files, cwd, context);
    return ok(describeClusterScoped(resource, item), cluster, files, cwd, context);
  }
  const namespaceCheck = requireNamespaceForResource(cluster, ns, resource, false);
  if (!namespaceCheck.ok) return ok(namespaceCheck.message, cluster, files, cwd, context);
  const collection = collectionFor(namespaceCheck.space, resource);
  if (!collection) return ok(unknownResource(args[1]), cluster, files, cwd, context);
  const item = collection[name];
  if (!item) return ok(notFound(resource, name), cluster, files, cwd, context);

  return ok(
    [
      `Name: ${item.name}`,
      `Namespace: ${item.namespace ?? ns}`,
      `Status: ${displayStatus(item)}`,
      `Spec: ${JSON.stringify(item.spec ?? {}, null, 2)}`,
    ].join("\n"),
    cluster,
    files,
    cwd,
    context,
  );
}

function createResource(args, cluster, files, cwd, context, ns) {
  const resource = args[1];

  if (resource === "namespace" || resource === "ns") {
    const nameArg = readSingleNameArg(args, 2);
    if (!nameArg.ok) return ok(nameArg.message, cluster, files, cwd, context);
    const name = nameArg.name;
    if (cluster.namespaces[name]) {
      return ok(`Error from server (AlreadyExists): namespaces "${name}" already exists`, cluster, files, cwd, context);
    }
    cluster.namespaces[name] = cluster.namespaces[name] ?? namespace(name);
    return ok(`namespace/${name} created`, cluster, files, cwd, context);
  }

  const namespaceCheck = requireNamespace(cluster, ns);
  if (!namespaceCheck.ok) return ok(namespaceCheck.message, cluster, files, cwd, context);

  if (resource === "deployment") {
    const nameArg = readSingleNameArg(args, 2);
    if (!nameArg.ok) return ok(nameArg.message, cluster, files, cwd, context);
    const name = nameArg.name;
    if (namespaceCheck.space.deployments[name]) return ok(alreadyExists("deployment", name), cluster, files, cwd, context);
    const image = parseImage(valueAfter(args, "--image"));
    if (!image.ok) return ok(image.message, cluster, files, cwd, context);
    const replicas = parseReplicas(valueAfter(args, "--replicas"));
    if (!replicas.ok) return ok(replicas.message, cluster, files, cwd, context);
    upsertDeployment(cluster, ns, {
      name,
      namespace: ns,
      image: image.value,
      replicas: replicas.value,
      labels: parseLabels(valueAfter(args, "--labels")) ?? { app: name },
      containers: [{ name: "app", image: image.value }],
    });
    return ok(`deployment.apps/${name} created`, cluster, files, cwd, context);
  }

  if (resource === "configmap") {
    const nameArg = readSingleNameArg(args, 2);
    if (!nameArg.ok) return ok(nameArg.message, cluster, files, cwd, context);
    const name = nameArg.name;
    if (namespaceCheck.space.configMaps[name]) return ok(alreadyExists("configmap", name), cluster, files, cwd, context);
    namespaceCheck.space.configMaps[name] = {
      name,
      namespace: ns,
      data: parseFromLiteralArgs(args),
      status: "Active",
    };
    return ok(`configmap/${name} created`, cluster, files, cwd, context);
  }

  if (resource === "secret" && args[2] === "generic") {
    const nameArg = readSingleNameArg(args, 3);
    if (!nameArg.ok) return ok(nameArg.message, cluster, files, cwd, context);
    const name = nameArg.name;
    if (namespaceCheck.space.secrets[name]) return ok(alreadyExists("secret", name), cluster, files, cwd, context);
    namespaceCheck.space.secrets[name] = {
      name,
      namespace: ns,
      type: "Opaque",
      data: parseFromLiteralArgs(args),
      status: "Active",
    };
    return ok(`secret/${name} created`, cluster, files, cwd, context);
  }

  if (resource === "service" && args[2] === "clusterip") {
    const nameArg = readSingleNameArg(args, 3);
    if (!nameArg.ok) return ok(nameArg.message, cluster, files, cwd, context);
    const name = nameArg.name;
    if (namespaceCheck.space.services[name]) return ok(alreadyExists("service", name), cluster, files, cwd, context);
    const tcp = parseTcpPortSpec(valueAfter(args, "--tcp"));
    if (!tcp.ok) return ok(tcp.message, cluster, files, cwd, context);
    namespaceCheck.space.services[name] = normalizeService({
      metadata: { name, namespace: ns },
      spec: { selector: { app: name }, ports: [{ port: tcp.port, targetPort: tcp.targetPort }], type: "ClusterIP" },
    });
    return ok(`service/${name} created`, cluster, files, cwd, context);
  }

  return ok(`create ${resource} is not implemented`, cluster, files, cwd, context);
}

function runPod(args, cluster, files, cwd, context, ns) {
  const nameArg = readSingleNameArg(args, 1);
  if (!nameArg.ok) return ok(nameArg.message, cluster, files, cwd, context);
  const name = nameArg.name;
  const namespaceCheck = requireNamespace(cluster, ns);
  if (!namespaceCheck.ok) return ok(namespaceCheck.message, cluster, files, cwd, context);
  if (namespaceCheck.space.pods[name]) return ok(alreadyExists("pod", name), cluster, files, cwd, context);
  const image = parseImage(valueAfter(args, "--image"));
  if (!image.ok) return ok(image.message, cluster, files, cwd, context);
  const labels = parseLabels(valueAfter(args, "--labels")) ?? { run: name };
  namespaceCheck.space.pods[name] = {
    name,
    namespace: ns,
    image: image.value,
    status: image.value.includes("broken") ? "ImagePullBackOff" : "Running",
    ready: image.value.includes("broken") ? "0/1" : "1/1",
    restarts: 0,
    nodeName: "worker-1",
    labels,
    spec: { containers: [{ name, image: image.value }] },
    logs: `${name} started with image ${image.value}`,
  };
  return ok(`pod/${name} created`, cluster, files, cwd, context);
}

function applyManifest(args, cluster, files, cwd, context) {
  const fileArg = valueAfter(args, "-f") ?? valueAfter(args, "--filename");
  if (!fileArg) return ok("error: must specify -f", cluster, files, cwd, context);
  const defaultNamespace = getNamespace(args, "default");

  const path = normalizePath(cwd, fileArg);
  const file = files[path];
  if (!file || file.type !== "file") return ok(`error: the path "${fileArg}" does not exist`, cluster, files, cwd, context);

  let docs;
  try {
    docs = parseAllDocuments(file.content, { keepSourceTokens: true });
  } catch (error) {
    return ok(`error: unable to parse YAML: ${error.message}`, cluster, files, cwd, context);
  }

  const messages = [];
  for (const doc of docs) {
    const object = doc.toJSON();
    if (!object) continue;
    const message = applyDocument(object, cluster, defaultNamespace, documentHints(doc));
    messages.push(message);
    if (message.startsWith("Error ") || message.startsWith("error:")) break;
  }
  return ok(messages.join("\n"), cluster, files, cwd, context);
}

function applyDocument(object, cluster, defaultNamespace = "default", hints = {}) {
  const kind = object?.kind;
  const metadata = object?.metadata ?? {};
  const name = metadata.name;
  const ns = metadata.namespace ?? defaultNamespace;

  if (!object?.apiVersion) return "error: apiVersion may not be empty";
  if (!kind) return "error: kind may not be empty";
  if (!name) return "error: resource name may not be empty";
  const expectedApiVersion = API_VERSION_BY_KIND[kind];
  if (!expectedApiVersion) return `error: resource mapping not found for name: "${name}" kind: "${kind}"`;
  if (object.apiVersion !== expectedApiVersion) {
    return `error: no matches for kind "${kind}" in version "${object.apiVersion}"`;
  }

  if (kind === "Namespace") {
    cluster.namespaces[name] = cluster.namespaces[name] ?? namespace(name);
    return `namespace/${name} configured`;
  }

  const namespaceCheck = requireNamespace(cluster, ns);
  if (!namespaceCheck.ok) return namespaceCheck.message;

  if (kind === "Deployment") {
    const replicas = parseManifestReplicas(object.spec?.replicas, hints.replicasSource);
    if (!replicas.ok) return replicas.message;
    object = {
      ...object,
      spec: {
        ...(object.spec ?? {}),
        replicas: replicas.value,
      },
    };
    upsertDeployment(cluster, ns, normalizeDeployment(object, ns));
    return `deployment.apps/${name} configured`;
  }

  const space = namespaceCheck.space;
  if (kind === "Pod") {
    space.pods[name] = normalizePod(object, ns);
    return `pod/${name} configured`;
  }

  if (kind === "Service") {
    space.services[name] = normalizeService(object);
    return `service/${name} configured`;
  }
  if (kind === "Ingress") {
    space.ingresses[name] = normalizeIngress(object);
    return `ingress/${name} configured`;
  }
  if (kind === "PersistentVolumeClaim") {
    space.persistentVolumeClaims[name] = normalizePersistentVolumeClaim(object);
    return `persistentvolumeclaim/${name} configured`;
  }
  if (kind === "ConfigMap") {
    space.configMaps[name] = {
      name,
      namespace: ns,
      metadata,
      data: object.data ?? {},
      spec: object.data ?? {},
      status: "Active",
    };
    return `configmap/${name} configured`;
  }
  if (kind === "Secret") {
    space.secrets[name] = {
      name,
      namespace: ns,
      metadata,
      type: object.type ?? "Opaque",
      data: object.data ?? object.stringData ?? {},
      spec: object.data ?? object.stringData ?? {},
      status: "Active",
    };
    return `secret/${name} configured`;
  }
  if (kind === "Role") {
    space.roles[name] = normalizeRole(object, ns);
    return `role/${name} configured`;
  }
  if (kind === "RoleBinding") {
    space.roleBindings[name] = normalizeRoleBinding(object, ns);
    return `rolebinding/${name} configured`;
  }
  if (kind === "NetworkPolicy") {
    space.networkPolicies[name] = normalizeNetworkPolicy(object, ns);
    return `networkpolicy/${name} configured`;
  }

  return `error: resource mapping not found for name: "${name}" kind: "${kind}"`;
}

function deleteResource(args, cluster, files, cwd, context, ns) {
  const target = splitKindName(args[1], args[2]);
  if (target.error) return ok(target.error, cluster, files, cwd, context);
  if (CLUSTER_SCOPED_RESOURCES.has(normalizeResource(target.kind))) {
    const collection = clusterCollectionFor(cluster, target.kind);
    if (!collection) return ok(unknownResource(args[1]), cluster, files, cwd, context);
    if (!collection[target.name]) return ok(notFound(target.kind, target.name), cluster, files, cwd, context);
    delete collection[target.name];
    return ok(`${deleteNameFor(target.kind)}/${target.name} deleted`, cluster, files, cwd, context);
  }
  const namespaceCheck = requireNamespaceForResource(cluster, ns, target.kind, false);
  if (!namespaceCheck.ok) return ok(namespaceCheck.message, cluster, files, cwd, context);
  const collection = collectionFor(namespaceCheck.space, normalizeResource(target.kind));
  if (!collection) return ok(unknownResource(args[1]), cluster, files, cwd, context);
  if (!collection[target.name]) {
    return ok(notFound(target.kind, target.name), cluster, files, cwd, context);
  }
  delete collection[target.name];
  if (normalizeResource(target.kind) === "deployment") {
    for (const [podName, pod] of Object.entries(namespaceCheck.space.pods)) {
      if (pod.owner === target.name) delete namespaceCheck.space.pods[podName];
    }
  }
  return ok(`${target.kind}/${target.name} deleted`, cluster, files, cwd, context);
}

function scaleResource(args, cluster, files, cwd, context, ns) {
  const target = splitKindName(args[1], args[2]);
  if (target.error) return ok(target.error, cluster, files, cwd, context);
  if (normalizeResource(target.kind) !== "deployment" && normalizeResource(target.kind) !== "deployments") {
    return ok(`error: cannot scale resource "${args[1]}"`, cluster, files, cwd, context);
  }
  if (valueAfter(args, "--replicas") === undefined) {
    return ok("error: required flag(s) \"replicas\" not set", cluster, files, cwd, context);
  }
  const replicas = parseReplicas(valueAfter(args, "--replicas"));
  if (!replicas.ok) return ok(replicas.message, cluster, files, cwd, context);
  const namespaceCheck = requireNamespace(cluster, ns);
  if (!namespaceCheck.ok) return ok(namespaceCheck.message, cluster, files, cwd, context);
  const deployment = namespaceCheck.space.deployments[target.name];
  if (!deployment) return ok(`Error from server (NotFound): deployment "${target.name}" not found`, cluster, files, cwd, context);
  deployment.replicas = replicas.value;
  deployment.availableReplicas = replicas.value;
  reconcileDeployment(namespaceCheck.space, deployment);
  return ok(`deployment.apps/${target.name} scaled`, cluster, files, cwd, context);
}

function setImage(args, cluster, files, cwd, context, ns) {
  const target = splitKindName(args[2], undefined);
  if (target.error) return ok(target.error, cluster, files, cwd, context);
  if (normalizeResource(target.kind) !== "deployment" && normalizeResource(target.kind) !== "deployments") {
    return ok(`error: cannot set image on resource "${args[2]}"`, cluster, files, cwd, context);
  }
  const assignment = args.find((arg, index) => index > 2 && arg.includes("="));
  if (!assignment) return ok("error: image update requires CONTAINER=IMAGE", cluster, files, cwd, context);
  const containerName = assignment.split("=")[0];
  const image = parseImage(assignment?.split("=").slice(1).join("="), undefined);
  if (!image.ok) return ok(image.message, cluster, files, cwd, context);
  const namespaceCheck = requireNamespace(cluster, ns);
  if (!namespaceCheck.ok) return ok(namespaceCheck.message, cluster, files, cwd, context);
  const deployment = namespaceCheck.space.deployments[target.name];
  if (!deployment) return ok(`Error from server (NotFound): deployment "${target.name}" not found`, cluster, files, cwd, context);
  if (!deployment.containers?.some((container) => container.name === containerName)) {
    return ok(`error: unable to find container named "${containerName}"`, cluster, files, cwd, context);
  }

  deployment.image = image.value;
  deployment.containers = deployment.containers.map((container) =>
    container.name === containerName ? { ...container, image: image.value } : container,
  );
  deployment.status = image.value.includes("broken") ? "Progressing" : "Available";
  reconcileDeployment(namespaceCheck.space, deployment);
  return ok(`deployment.apps/${target.name} image updated`, cluster, files, cwd, context);
}

function rolloutStatus(args, cluster, files, cwd, context, ns) {
  if (args[1] !== "status") return ok("error: only rollout status is simulated", cluster, files, cwd, context);
  const target = splitKindName(args.find((arg) => arg.includes("/")) ?? args[2], undefined);
  if (target.error) return ok(target.error, cluster, files, cwd, context);
  if (normalizeResource(target.kind) !== "deployment" && normalizeResource(target.kind) !== "deployments") {
    return ok(`error: rollout status is only simulated for deployments`, cluster, files, cwd, context);
  }
  const namespaceCheck = requireNamespace(cluster, ns);
  if (!namespaceCheck.ok) return ok(namespaceCheck.message, cluster, files, cwd, context);
  const deployment = namespaceCheck.space.deployments[target.name];
  if (!deployment) return ok(`Error from server (NotFound): deployment "${target.name}" not found`, cluster, files, cwd, context);
  if (deployment.status !== "Available" || deployment.availableReplicas !== deployment.replicas) {
    return ok(
      `waiting for deployment "${target.name}" rollout to finish: ${deployment.availableReplicas ?? 0} of ${deployment.replicas} updated replicas are available`,
      cluster,
      files,
      cwd,
      context,
    );
  }
  return ok(`deployment "${target.name}" successfully rolled out`, cluster, files, cwd, context);
}

function logsFor(args, cluster, files, cwd, context, ns) {
  const target = parseLogsTarget(args[1]);
  if (target.error) return ok(target.error, cluster, files, cwd, context);
  const namespaceCheck = requireNamespace(cluster, ns);
  if (!namespaceCheck.ok) return ok(namespaceCheck.message, cluster, files, cwd, context);
  const space = namespaceCheck.space;
  if (target.kind === "deployment" || target.kind === "deployments") {
    const deployment = space.deployments[target.name];
    if (!deployment) return ok(alreadyMissingDeployment(target.name), cluster, files, cwd, context);
    const pod = Object.values(space.pods).find((item) => item.owner === target.name);
    if (!pod) return ok(`Error from server (NotFound): pods for deployment "${target.name}" not found`, cluster, files, cwd, context);
    return ok(pod.logs ?? "simulated application log: request completed with status=200", cluster, files, cwd, context);
  }
  const pod = space.pods[target.name];
  if (!pod) return ok(notFound("pod", target.name), cluster, files, cwd, context);
  return ok(pod.logs ?? "simulated application log: request completed with status=200", cluster, files, cwd, context);
}

function topResource(args, cluster, files, cwd, context) {
  if (args[1] !== "nodes") return ok("Only kubectl top nodes is simulated", cluster, files, cwd, context);
  const nodeName = args[2]?.startsWith("-") ? undefined : args[2];
  if (nodeName) {
    const node = cluster.nodes[nodeName];
    if (!node) return ok(`Error from server (NotFound): nodes "${nodeName}" not found`, cluster, files, cwd, context);
    return ok(table(["NAME", "CPU(cores)", "MEMORY(bytes)"], [[node.name, node.cpu, node.memory]]), cluster, files, cwd, context);
  }
  return ok(
    table(
      ["NAME", "CPU(cores)", "MEMORY(bytes)"],
      Object.values(cluster.nodes).map((node) => [node.name, node.cpu, node.memory]),
    ),
    cluster,
    files,
    cwd,
    context,
  );
}

function setNodeSchedulable(args, cluster, files, cwd, context, schedulable) {
  const node = cluster.nodes[args[1]];
  if (!node) return ok(`Error from server (NotFound): nodes "${args[1]}" not found`, cluster, files, cwd, context);
  node.schedulable = schedulable;
  return ok(`node/${node.name} ${schedulable ? "uncordoned" : "cordoned"}`, cluster, files, cwd, context);
}

function drainNode(args, cluster, files, cwd, context) {
  const node = cluster.nodes[args[1]];
  if (!node) return ok(`Error from server (NotFound): nodes "${args[1]}" not found`, cluster, files, cwd, context);
  node.schedulable = false;
  return ok(`node/${node.name} drained`, cluster, files, cwd, context);
}

function normalizeDeployment(object, ns) {
  const metadata = object.metadata ?? {};
  const spec = object.spec ?? {};
  const template = spec.template ?? {};
  const templateSpec = template.spec ?? {};
  const containers = templateSpec.containers ?? spec.containers ?? [];
  const image = containers[0]?.image ?? "nginx:1.27";
  const replicas = Number(spec.replicas ?? 1);
  const labels =
    template.metadata?.labels ??
    spec.selector?.matchLabels ??
    metadata.labels ??
    { app: metadata.name };

  return {
    name: metadata.name,
    namespace: metadata.namespace ?? ns,
    image,
    replicas,
    availableReplicas: image.includes("broken") ? 0 : replicas,
    status: image.includes("broken") ? "Progressing" : "Available",
    labels,
    containers,
    spec,
    metadata,
  };
}

function normalizePod(object, ns) {
  const metadata = object.metadata ?? {};
  const spec = object.spec ?? {};
  const containers = spec.containers ?? [];
  const image = containers[0]?.image ?? "nginx:1.27";
  const pvc = (spec.volumes ?? []).find((volume) => volume.persistentVolumeClaim)?.persistentVolumeClaim;

  return {
    name: metadata.name,
    namespace: metadata.namespace ?? ns,
    image,
    status: image.includes("broken") ? "ImagePullBackOff" : "Running",
    ready: image.includes("broken") ? "0/1" : "1/1",
    restarts: 0,
    nodeName: spec.nodeName ?? "worker-1",
    labels: metadata.labels ?? { run: metadata.name },
    spec: {
      ...spec,
      persistentVolumeClaim: pvc,
    },
    logs: `${metadata.name} started with image ${image}`,
  };
}

function normalizeService(object) {
  const metadata = object.metadata ?? {};
  const spec = object.spec ?? {};
  const firstPort = spec.ports?.[0] ?? {};
  return {
    name: metadata.name,
    namespace: metadata.namespace ?? "default",
    metadata,
    type: spec.type ?? "ClusterIP",
    selector: spec.selector ?? {},
    ports: spec.ports ?? [],
    clusterIP: "10.96.20.20",
    spec: {
      ...spec,
      targetPort: firstPort.targetPort ?? firstPort.port,
      port: firstPort.port,
    },
    status: "Active",
  };
}

function normalizeIngress(object) {
  const metadata = object.metadata ?? {};
  const spec = object.spec ?? {};
  return {
    name: metadata.name,
    namespace: metadata.namespace ?? "default",
    metadata,
    className: spec.ingressClassName,
    hosts: (spec.rules ?? []).map((rule) => rule.host).filter(Boolean),
    address: "10.0.0.100",
    ports: [80],
    spec,
    status: "Active",
  };
}

function normalizePersistentVolumeClaim(object) {
  const metadata = object.metadata ?? {};
  const spec = object.spec ?? {};
  return {
    name: metadata.name,
    namespace: metadata.namespace ?? "default",
    metadata,
    spec,
    storageClassName: spec.storageClassName,
    capacity: spec.resources?.requests?.storage,
    accessModes: spec.accessModes ?? ["ReadWriteOnce"],
    status: "Bound",
  };
}

function normalizeRole(object, ns) {
  const metadata = object.metadata ?? {};
  const rawRules = object.spec?.rules ?? object.rules ?? [];
  const resources = flatten([rawRules].flat().map((rule) => rule?.resources ?? rule?.resource ?? rawRules.resources));
  const verbs = flatten([rawRules].flat().map((rule) => rule?.verbs ?? rawRules.verbs));
  return {
    name: metadata.name,
    namespace: metadata.namespace ?? ns,
    metadata,
    rules: rawRules,
    spec: {
      ...(object.spec ?? {}),
      rules: {
        raw: rawRules,
        resources: resources.join(","),
        verbs: verbs.join(","),
      },
    },
    status: "Active",
  };
}

function normalizeRoleBinding(object, ns) {
  const metadata = object.metadata ?? {};
  const roleRef = object.spec?.roleRef ?? object.roleRef ?? {};
  const subjects = object.spec?.subjects ?? object.subjects ?? [];
  return {
    name: metadata.name,
    namespace: metadata.namespace ?? ns,
    metadata,
    roleRef,
    subjects,
    spec: {
      ...(object.spec ?? {}),
      roleRef,
      subjects,
    },
    status: "Active",
  };
}

function normalizeNetworkPolicy(object, ns) {
  const metadata = object.metadata ?? {};
  const spec = object.spec ?? {};
  return {
    name: metadata.name,
    namespace: metadata.namespace ?? ns,
    metadata,
    spec,
    status: "Active",
  };
}

function upsertDeployment(cluster, ns, deployment) {
  const space = ensureNamespace(cluster, ns);
  space.deployments[deployment.name] = {
    status: "Available",
    labels: { app: deployment.name },
    ...deployment,
  };
  reconcileDeployment(space, space.deployments[deployment.name]);
}

function reconcileDeployment(space, deployment) {
  for (const key of Object.keys(space.pods)) {
    if (space.pods[key].owner === deployment.name) delete space.pods[key];
  }

  const broken = deployment.image?.includes("broken");
  deployment.status = broken ? "Progressing" : "Available";
  deployment.availableReplicas = broken ? 0 : deployment.replicas;

  for (let index = 0; index < deployment.replicas; index += 1) {
    const name = `${deployment.name}-${index + 1}`;
    space.pods[name] = {
      name,
      namespace: deployment.namespace ?? space.name,
      owner: deployment.name,
      image: deployment.image,
      status: broken ? "ImagePullBackOff" : "Running",
      ready: broken ? "0/1" : "1/1",
      restarts: broken ? 3 : 0,
      nodeName: index % 2 === 0 ? "worker-1" : "control-plane",
      labels: deployment.labels ?? { app: deployment.name },
      spec: { containers: deployment.containers ?? [{ name: "app", image: deployment.image }] },
      logs: broken ? `failed to pull image ${deployment.image}` : `${deployment.name} serving traffic`,
    };
  }
}

function ensureNamespace(cluster, name) {
  cluster.namespaces[name] = cluster.namespaces[name] ?? namespace(name);
  return cluster.namespaces[name];
}

function requireNamespace(cluster, name) {
  const space = cluster.namespaces[name];
  if (!space) return { ok: false, message: namespaceNotFound(name) };
  return { ok: true, space };
}

function requireNamespaceForResource(cluster, name, resource, allNamespaces) {
  if (allNamespaces || CLUSTER_SCOPED_RESOURCES.has(normalizeResource(resource))) {
    return { ok: true, space: null };
  }
  return requireNamespace(cluster, name);
}

function namespaceNotFound(name) {
  return `Error from server (NotFound): namespaces "${name}" not found`;
}

function clusterCollectionFor(cluster, resource) {
  return {
    namespaces: cluster.namespaces,
    nodes: cluster.nodes,
    storageclasses: cluster.storageClasses,
  }[normalizeResource(resource)];
}

function describeClusterScoped(resource, item) {
  return [
    `Name: ${item.name}`,
    `Status: ${clusterScopedStatus(resource, item)}`,
    `Spec: ${JSON.stringify(item.spec ?? {}, null, 2)}`,
  ].join("\n");
}

function clusterScopedStatus(resource, item) {
  if (normalizeResource(resource) === "namespaces") return "Active";
  return item.status ?? "Active";
}

function deleteNameFor(resource) {
  return {
    namespaces: "namespace",
    nodes: "node",
    storageclasses: "storageclass",
  }[normalizeResource(resource)] ?? normalizeResource(resource);
}

function collectionFor(space, resource) {
  if (!space) return undefined;
  return {
    pods: space.pods,
    pod: space.pods,
    deployments: space.deployments,
    deployment: space.deployments,
    services: space.services,
    service: space.services,
    ingresses: space.ingresses,
    ingress: space.ingresses,
    pvc: space.persistentVolumeClaims,
    pvcs: space.persistentVolumeClaims,
    persistentvolumeclaim: space.persistentVolumeClaims,
    persistentvolumeclaims: space.persistentVolumeClaims,
    configmaps: space.configMaps,
    configmap: space.configMaps,
    secrets: space.secrets,
    secret: space.secrets,
    roles: space.roles,
    role: space.roles,
    rolebindings: space.roleBindings,
    rolebinding: space.roleBindings,
    networkpolicies: space.networkPolicies,
    networkpolicy: space.networkPolicies,
  }[normalizeResource(resource)];
}

function parseResourceTarget(args, index) {
  const raw = args[index] ?? "";
  if (raw.includes("/")) return splitKindName(raw, undefined);
  const possibleName = args[index + 1];
  return {
    kind: normalizeResource(raw),
    name: possibleName && !possibleName.startsWith("-") ? possibleName : undefined,
  };
}

function parseLogsTarget(raw = "") {
  if (raw.includes("/")) return splitKindName(raw, undefined);
  return { kind: "pod", name: raw };
}

function normalizeResource(input = "") {
  const value = input.split(".")[0].toLowerCase();
  const aliases = {
    ns: "namespaces",
    namespace: "namespaces",
    namespaces: "namespaces",
    no: "nodes",
    node: "nodes",
    nodes: "nodes",
    sc: "storageclasses",
    storageclass: "storageclasses",
    storageclasses: "storageclasses",
    po: "pods",
    pod: "pod",
    pods: "pods",
    deploy: "deployments",
    deployment: "deployment",
    deployments: "deployments",
    svc: "services",
    service: "service",
    services: "services",
    ing: "ingresses",
    ingress: "ingress",
    ingresses: "ingresses",
  };
  return aliases[value] ?? value;
}

function getNamespace(args, fallback) {
  return (
    valueAfter(args, "-n") ??
    valueAfter(args, "--namespace") ??
    args.find((arg) => arg.startsWith("--namespace="))?.split("=")[1] ??
    fallback
  );
}

function valueAfter(args, flag) {
  const direct = args.find((arg) => arg.startsWith(`${flag}=`));
  if (direct) return direct.split("=").slice(1).join("=");
  if (/^-[A-Za-z]$/.test(flag)) {
    const compact = args.find((arg) => arg.startsWith(flag) && arg.length > flag.length);
    if (compact) return compact.slice(flag.length);
  }
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

function readSingleNameArg(args, index) {
  const names = positionalArgs(args, index);
  if (names.length === 0) return { ok: false, message: "error: name is required" };
  if (names.length > 1) return { ok: false, message: `error: exactly one NAME is required, got ${names.length}` };
  return { ok: true, name: names[0] };
}

function positionalArgs(args, startIndex) {
  const flagsWithValues = new Set([
    "-f",
    "-n",
    "--filename",
    "--from-literal",
    "--image",
    "--labels",
    "--namespace",
    "--replicas",
    "--tcp",
  ]);
  const values = [];
  for (let index = startIndex; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg) continue;
    if (arg.startsWith("--") && arg.includes("=")) continue;
    if (arg.startsWith("-")) {
      if (flagsWithValues.has(arg)) index += 1;
      continue;
    }
    values.push(arg);
  }
  return values;
}

function parseReplicas(value, fallback = 1) {
  if (value === undefined || value === null) return { ok: true, value: fallback };
  const text = String(value).trim();
  if (text === "" || !/^(0|[1-9]\d*)$/.test(text)) {
    return { ok: false, message: `error: invalid replicas value "${value}"` };
  }
  const replicas = Number(text);
  if (!Number.isInteger(replicas) || replicas < 0) {
    return { ok: false, message: `error: invalid replicas value "${value}"` };
  }
  return { ok: true, value: replicas };
}

function parseManifestReplicas(value, source) {
  if (value === undefined || value === null) return parseReplicas(value);
  if (source !== undefined && !/^(0|[1-9]\d*)$/.test(String(source).trim())) {
    return { ok: false, message: `error: invalid replicas value "${source}"` };
  }
  return parseReplicas(source ?? value);
}

function parseImage(value, fallback = "nginx:1.27") {
  if (value === undefined || value === null) {
    if (fallback === undefined) return { ok: false, message: "error: image must not be empty" };
    return { ok: true, value: fallback };
  }
  if (String(value).trim() === "" || String(value).startsWith("-")) {
    return { ok: false, message: "error: image must not be empty" };
  }
  return { ok: true, value: String(value) };
}

function parseTcpPortSpec(value, fallback = "80:80") {
  const raw = value === undefined || value === null ? fallback : String(value);
  const [portValue, targetPortValue, extra] = raw.split(":");
  const port = parsePort(portValue);
  const targetPort = parsePort(targetPortValue ?? portValue);
  if (extra !== undefined || !port.ok || !targetPort.ok) {
    return { ok: false, message: `error: invalid tcp value "${raw}"` };
  }
  return { ok: true, port: port.value, targetPort: targetPort.value };
}

function parsePort(value) {
  if (value === undefined || value === null || !/^(0|[1-9]\d*)$/.test(String(value).trim())) return { ok: false };
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return { ok: false };
  return { ok: true, value: port };
}

function splitKindName(kindOrTarget = "", name) {
  if (kindOrTarget.includes("/")) {
    const parts = kindOrTarget.split("/");
    if (parts.length > 2) return { error: invalidResourceTarget(), kind: normalizeResource(parts[0]), name: parts[1] };
    const [kind, targetName] = parts;
    return { kind: normalizeResource(kind), name: targetName };
  }
  return { kind: normalizeResource(kindOrTarget), name };
}

function documentHints(doc) {
  return {
    replicasSource: doc.getIn(["spec", "replicas"], true)?.srcToken?.source,
  };
}

function invalidResourceTarget() {
  return "error: arguments in resource/name form may not have more than one slash";
}

function unknownResource(input) {
  const resource = String(input ?? "").split("/")[0];
  return `error: the server doesn't have a resource type "${resource}"`;
}

function notFound(resource, name) {
  return `Error from server (NotFound): ${resourceNameForError(resource)} "${name}" not found`;
}

function alreadyExists(resource, name) {
  return `Error from server (AlreadyExists): ${resourceNameForError(resource)} "${name}" already exists`;
}

function alreadyMissingDeployment(name) {
  return `Error from server (NotFound): deployments.apps "${name}" not found`;
}

function resourceNameForError(resource) {
  const value = normalizeResource(resource);
  return {
    pod: "pods",
    pods: "pods",
    deployment: "deployments.apps",
    deployments: "deployments.apps",
    service: "services",
    services: "services",
    configmap: "configmaps",
    configmaps: "configmaps",
    secret: "secrets",
    secrets: "secrets",
    ingress: "ingresses.networking.k8s.io",
    ingresses: "ingresses.networking.k8s.io",
    role: "roles.rbac.authorization.k8s.io",
    roles: "roles.rbac.authorization.k8s.io",
    rolebinding: "rolebindings.rbac.authorization.k8s.io",
    rolebindings: "rolebindings.rbac.authorization.k8s.io",
    networkpolicy: "networkpolicies.networking.k8s.io",
    networkpolicies: "networkpolicies.networking.k8s.io",
    pvc: "persistentvolumeclaims",
    pvcs: "persistentvolumeclaims",
    persistentvolumeclaim: "persistentvolumeclaims",
    persistentvolumeclaims: "persistentvolumeclaims",
  }[value] ?? value;
}

function parseFromLiteralArgs(args) {
  const data = {};
  for (const arg of args) {
    if (!arg.startsWith("--from-literal=")) continue;
    const literal = arg.replace("--from-literal=", "");
    const [key, ...rest] = literal.split("=");
    data[key] = rest.join("=");
  }
  return data;
}

function parseLabels(value) {
  if (!value) return null;
  return Object.fromEntries(
    value
      .split(",")
      .map((pair) => pair.split("="))
      .filter(([key, labelValue]) => key && labelValue),
  );
}

function flatten(value) {
  return value.flatMap((item) => {
    if (!item) return [];
    if (Array.isArray(item)) return flatten(item);
    if (typeof item === "string") return item.split(",").map((part) => part.trim()).filter(Boolean);
    return [];
  });
}

function displayStatus(item) {
  if (item.ready) return item.status;
  if (typeof item.replicas === "number") return `${item.availableReplicas ?? item.replicas}/${item.replicas}`;
  if (item.status) return item.status;
  return "Active";
}

function table(headers, rows) {
  const visibleRows = rows.length ? rows : [];
  const allRows = [headers, ...visibleRows];
  const widths = headers.map((_, index) => Math.max(...allRows.map((row) => String(row[index] ?? "").length)));
  return allRows.map((row) => row.map((cell, index) => String(cell ?? "").padEnd(widths[index])).join("   ")).join("\n");
}

function ok(output, cluster, files, cwd, context) {
  return { output, cluster, files, cwd, context };
}
