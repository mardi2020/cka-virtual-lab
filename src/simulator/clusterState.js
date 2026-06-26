export function createInitialCluster() {
  const cluster = {
    currentContext: "k8s-admin@sim-cluster",
    contexts: ["k8s-admin@sim-cluster", "readonly@sim-cluster"],
    namespaces: {
      default: namespace("default"),
      "kube-system": namespace("kube-system"),
      workloads: namespace("workloads"),
      storage: namespace("storage"),
      network: namespace("network"),
      security: namespace("security"),
      troubleshooting: namespace("troubleshooting"),
    },
    nodes: {
      "control-plane": { name: "control-plane", status: "Ready", schedulable: true, role: "control-plane", version: "v1.33.1", internalIP: "10.0.0.10", cpu: "390m", memory: "920Mi" },
      "worker-1": { name: "worker-1", status: "Ready", schedulable: true, role: "worker", version: "v1.33.1", internalIP: "10.0.0.21", cpu: "460m", memory: "1260Mi" },
      "worker-2": { name: "worker-2", status: "NotReady", schedulable: true, role: "worker", version: "v1.33.1", internalIP: "10.0.0.22", cpu: "0m", memory: "0Mi" },
    },
    storageClasses: {
      fast: { name: "fast", provisioner: "kubernetes.io/no-provisioner", default: false },
      standard: { name: "standard", provisioner: "kubernetes.io/no-provisioner", default: true },
    },
  };

  cluster.namespaces["kube-system"].pods["coredns-558bd4d5db-a1b2c"] = {
    name: "coredns-558bd4d5db-a1b2c",
    namespace: "kube-system",
    image: "registry.k8s.io/coredns/coredns:v1.12.0",
    status: "Running",
    ready: "1/1",
    restarts: 0,
    nodeName: "control-plane",
    labels: { k8sApp: "kube-dns" },
    logs: "CoreDNS-1.12.0 ready for queries",
  };
  cluster.namespaces["kube-system"].pods["metrics-server-6c9dd6d787-x7z4m"] = {
    name: "metrics-server-6c9dd6d787-x7z4m",
    namespace: "kube-system",
    image: "registry.k8s.io/metrics-server/metrics-server:v0.7.2",
    status: "Running",
    ready: "1/1",
    restarts: 1,
    nodeName: "worker-1",
    labels: { app: "metrics-server" },
    logs: "metrics-server scraping nodes successfully",
  };

  cluster.namespaces.workloads.deployments.api = {
    name: "api",
    namespace: "workloads",
    image: "registry.k8s.io/e2e-test-images/agnhost:2.53",
    replicas: 2,
    availableReplicas: 2,
    status: "Available",
    labels: { app: "api", tier: "backend" },
    containers: [{ name: "api", image: "registry.k8s.io/e2e-test-images/agnhost:2.53" }],
  };
  cluster.namespaces.workloads.pods["api-1"] = {
    name: "api-1",
    namespace: "workloads",
    owner: "api",
    image: "registry.k8s.io/e2e-test-images/agnhost:2.53",
    status: "Running",
    ready: "1/1",
    restarts: 0,
    nodeName: "worker-1",
    labels: { app: "api", tier: "backend" },
    logs: "api server listening on :8080",
  };
  cluster.namespaces.workloads.pods["api-2"] = {
    name: "api-2",
    namespace: "workloads",
    owner: "api",
    image: "registry.k8s.io/e2e-test-images/agnhost:2.53",
    status: "Running",
    ready: "1/1",
    restarts: 0,
    nodeName: "control-plane",
    labels: { app: "api", tier: "backend" },
    logs: "api health probe returned ok",
  };
  cluster.namespaces.workloads.services.api = {
    name: "api",
    namespace: "workloads",
    type: "ClusterIP",
    clusterIP: "10.96.20.10",
    selector: { app: "api" },
    ports: [{ port: 80, targetPort: 8080, protocol: "TCP" }],
    status: "Active",
  };
  cluster.namespaces.workloads.configMaps["app-config"] = {
    name: "app-config",
    namespace: "workloads",
    data: { LOG_LEVEL: "info", FEATURE_FLAG: "enabled" },
    status: "Active",
  };
  cluster.namespaces.workloads.secrets["api-token"] = {
    name: "api-token",
    namespace: "workloads",
    type: "Opaque",
    data: { token: "simulated-token" },
    status: "Active",
  };

  cluster.namespaces.network.ingresses["api-ingress"] = {
    name: "api-ingress",
    namespace: "network",
    className: "nginx",
    hosts: ["api.practice.local"],
    address: "10.0.0.100",
    ports: [80],
    spec: {
      ingressClassName: "nginx",
      rules: [{ host: "api.practice.local" }],
    },
    status: "Active",
  };
  cluster.namespaces.network.networkPolicies["default-deny"] = {
    name: "default-deny",
    namespace: "network",
    podSelector: {},
    policyTypes: ["Ingress"],
    spec: { podSelector: {}, policyTypes: ["Ingress"] },
    status: "Active",
  };

  cluster.namespaces.storage.persistentVolumeClaims.data = {
    name: "data",
    namespace: "storage",
    status: "Bound",
    volume: "pvc-data",
    capacity: "1Gi",
    accessModes: ["ReadWriteOnce"],
    storageClassName: "standard",
  };

  cluster.namespaces.security.roles["existing-viewer"] = {
    name: "existing-viewer",
    namespace: "security",
    rules: [{ apiGroups: [""], resources: ["pods"], verbs: ["get", "list", "watch"] }],
    status: "Active",
  };
  cluster.namespaces.security.roleBindings["existing-viewer-binding"] = {
    name: "existing-viewer-binding",
    namespace: "security",
    roleRef: { apiGroup: "rbac.authorization.k8s.io", kind: "Role", name: "existing-viewer" },
    subjects: [{ kind: "ServiceAccount", name: "default", namespace: "security" }],
    status: "Active",
  };

  return cluster;
}

export function namespace(name) {
  return {
    name,
    pods: {},
    deployments: {},
    services: {},
    ingresses: {},
    persistentVolumeClaims: {},
    configMaps: {},
    secrets: {},
    roles: {},
    roleBindings: {},
    networkPolicies: {},
  };
}
