import { parseAllDocuments } from "yaml";
import { normalizePath } from "./filesystem.js";
import { namespace } from "./clusterState.js";

export function runKubectl({ args, cluster, files, cwd, context }) {
  const nextCluster = structuredClone(cluster);
  const command = args[0];
  const namespaceName = getNamespace(args, "default");

  if (args.join(" ") === "config current-context") {
    return ok(nextCluster.currentContext, nextCluster, files, cwd, context);
  }

  if (args[0] === "config" && args[1] === "use-context") {
    nextCluster.currentContext = args[2] ?? nextCluster.currentContext;
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
  const resource = normalizeResource(args[1]);
  const allNamespaces = args.includes("-A") || args.includes("--all-namespaces");
  const ns = getNamespace(args, "default");

  if (resource === "namespaces") {
    return ok(
      table(["NAME", "STATUS"], Object.keys(cluster.namespaces).map((name) => [name, "Active"])),
      cluster,
      files,
      cwd,
      context,
    );
  }

  if (resource === "nodes") {
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

  const spaces = allNamespaces ? Object.values(cluster.namespaces) : [ensureNamespace(cluster, ns)];
  const rows = [];
  for (const space of spaces) {
    for (const item of Object.values(collectionFor(space, resource))) {
      rows.push(allNamespaces ? [space.name, item.name, displayStatus(item)] : [item.name, displayStatus(item)]);
    }
  }

  return ok(table(allNamespaces ? ["NAMESPACE", "NAME", "STATUS"] : ["NAME", "STATUS"], rows), cluster, files, cwd, context);
}

function describeResource(args, cluster, files, cwd, context) {
  const resource = normalizeResource(args[1]);
  const name = args[2];
  const ns = getNamespace(args, "default");
  const item = collectionFor(ensureNamespace(cluster, ns), resource)[name];
  if (!item) return ok(`Error from server (NotFound): ${resource} "${name}" not found`, cluster, files, cwd, context);

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
    const name = args[2];
    cluster.namespaces[name] = cluster.namespaces[name] ?? namespace(name);
    return ok(`namespace/${name} created`, cluster, files, cwd, context);
  }

  if (resource === "deployment") {
    const name = args[2];
    const image = valueAfter(args, "--image") ?? "nginx:1.27";
    const replicas = Number(valueAfter(args, "--replicas") ?? "1");
    upsertDeployment(cluster, ns, {
      name,
      namespace: ns,
      image,
      replicas,
      labels: parseLabels(valueAfter(args, "--labels")) ?? { app: name },
      containers: [{ name: "app", image }],
    });
    return ok(`deployment.apps/${name} created`, cluster, files, cwd, context);
  }

  if (resource === "configmap") {
    const name = args[2];
    ensureNamespace(cluster, ns).configMaps[name] = {
      name,
      namespace: ns,
      data: parseFromLiteralArgs(args),
      status: "Active",
    };
    return ok(`configmap/${name} created`, cluster, files, cwd, context);
  }

  if (resource === "secret" && args[2] === "generic") {
    const name = args[3];
    ensureNamespace(cluster, ns).secrets[name] = {
      name,
      namespace: ns,
      type: "Opaque",
      data: parseFromLiteralArgs(args),
      status: "Active",
    };
    return ok(`secret/${name} created`, cluster, files, cwd, context);
  }

  if (resource === "service" && args[2] === "clusterip") {
    const name = args[3];
    const tcp = valueAfter(args, "--tcp") ?? "80:80";
    const [port, targetPort] = tcp.split(":").map(Number);
    ensureNamespace(cluster, ns).services[name] = normalizeService({
      metadata: { name, namespace: ns },
      spec: { selector: { app: name }, ports: [{ port, targetPort }], type: "ClusterIP" },
    });
    return ok(`service/${name} created`, cluster, files, cwd, context);
  }

  return ok(`create ${resource} is not implemented`, cluster, files, cwd, context);
}

function runPod(args, cluster, files, cwd, context, ns) {
  const name = args[1];
  const image = valueAfter(args, "--image") ?? "nginx:1.27";
  const labels = parseLabels(valueAfter(args, "--labels")) ?? { run: name };
  ensureNamespace(cluster, ns).pods[name] = {
    name,
    namespace: ns,
    image,
    status: image.includes("broken") ? "ImagePullBackOff" : "Running",
    ready: image.includes("broken") ? "0/1" : "1/1",
    restarts: 0,
    nodeName: "worker-1",
    labels,
    spec: { containers: [{ name, image }] },
    logs: `${name} started with image ${image}`,
  };
  return ok(`pod/${name} created`, cluster, files, cwd, context);
}

function applyManifest(args, cluster, files, cwd, context) {
  const fileArg = valueAfter(args, "-f") ?? valueAfter(args, "--filename");
  if (!fileArg) return ok("error: must specify -f", cluster, files, cwd, context);

  const path = normalizePath(cwd, fileArg);
  const file = files[path];
  if (!file || file.type !== "file") return ok(`error: the path "${fileArg}" does not exist`, cluster, files, cwd, context);

  let docs;
  try {
    docs = parseAllDocuments(file.content).map((doc) => doc.toJSON()).filter(Boolean);
  } catch (error) {
    return ok(`error: unable to parse YAML: ${error.message}`, cluster, files, cwd, context);
  }

  const messages = docs.map((doc) => applyDocument(doc, cluster));
  return ok(messages.join("\n"), cluster, files, cwd, context);
}

function applyDocument(object, cluster) {
  const kind = object?.kind;
  const metadata = object?.metadata ?? {};
  const name = metadata.name;
  const ns = metadata.namespace ?? "default";

  if (!kind || !name) return "object/unknown skipped";
  ensureNamespace(cluster, ns);

  if (kind === "Namespace") {
    cluster.namespaces[name] = cluster.namespaces[name] ?? namespace(name);
    return `namespace/${name} configured`;
  }

  if (kind === "Deployment") {
    upsertDeployment(cluster, ns, normalizeDeployment(object, ns));
    return `deployment.apps/${name} configured`;
  }

  if (kind === "Pod") {
    ensureNamespace(cluster, ns).pods[name] = normalizePod(object, ns);
    return `pod/${name} configured`;
  }

  const space = ensureNamespace(cluster, ns);
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

  return `${kind.toLowerCase()}/${name} accepted`;
}

function deleteResource(args, cluster, files, cwd, context, ns) {
  const target = splitKindName(args[1], args[2]);
  const collection = collectionFor(ensureNamespace(cluster, ns), normalizeResource(target.kind));
  if (!collection[target.name]) {
    return ok(`Error from server (NotFound): ${target.kind} "${target.name}" not found`, cluster, files, cwd, context);
  }
  delete collection[target.name];
  return ok(`${target.kind}/${target.name} deleted`, cluster, files, cwd, context);
}

function scaleResource(args, cluster, files, cwd, context, ns) {
  const target = splitKindName(args[1], args[2]);
  const replicas = Number(valueAfter(args, "--replicas") ?? "1");
  const deployment = ensureNamespace(cluster, ns).deployments[target.name];
  if (!deployment) return ok(`Error from server (NotFound): deployment "${target.name}" not found`, cluster, files, cwd, context);
  deployment.replicas = replicas;
  deployment.availableReplicas = replicas;
  reconcileDeployment(ensureNamespace(cluster, ns), deployment);
  return ok(`deployment.apps/${target.name} scaled`, cluster, files, cwd, context);
}

function setImage(args, cluster, files, cwd, context, ns) {
  const target = splitKindName(args[2], undefined);
  const assignment = args.find((arg, index) => index > 2 && arg.includes("="));
  const image = assignment?.split("=").slice(1).join("=");
  const deployment = ensureNamespace(cluster, ns).deployments[target.name];
  if (!deployment) return ok(`Error from server (NotFound): deployment "${target.name}" not found`, cluster, files, cwd, context);

  deployment.image = image;
  deployment.containers = [{ name: assignment?.split("=")[0] ?? "app", image }];
  deployment.status = image?.includes("broken") ? "Progressing" : "Available";
  reconcileDeployment(ensureNamespace(cluster, ns), deployment);
  return ok(`deployment.apps/${target.name} image updated`, cluster, files, cwd, context);
}

function rolloutStatus(args, cluster, files, cwd, context, ns) {
  const target = splitKindName(args.find((arg) => arg.includes("/")) ?? args[2], undefined);
  const deployment = ensureNamespace(cluster, ns).deployments[target.name];
  if (!deployment) return ok(`Error from server (NotFound): deployment "${target.name}" not found`, cluster, files, cwd, context);
  return ok(`deployment "${target.name}" successfully rolled out`, cluster, files, cwd, context);
}

function logsFor(args, cluster, files, cwd, context, ns) {
  const target = splitKindName(args[1], undefined);
  const space = ensureNamespace(cluster, ns);
  const pod =
    space.pods[target.name] ??
    Object.values(space.pods).find((item) => item.owner === target.name) ??
    Object.values(space.pods)[0];
  return ok(pod?.logs ?? "simulated application log: request completed with status=200", cluster, files, cwd, context);
}

function topResource(args, cluster, files, cwd, context) {
  if (args[1] !== "nodes") return ok("Only kubectl top nodes is simulated", cluster, files, cwd, context);
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

function collectionFor(space, resource) {
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
  }[resource] ?? {};
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
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

function splitKindName(kindOrTarget = "", name) {
  if (kindOrTarget.includes("/")) {
    const [kind, targetName] = kindOrTarget.split("/");
    return { kind: normalizeResource(kind), name: targetName };
  }
  return { kind: normalizeResource(kindOrTarget), name };
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
