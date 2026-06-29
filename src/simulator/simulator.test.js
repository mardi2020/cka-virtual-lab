import { describe, expect, it } from "vitest";
import { createLabSession } from "./createLabSession.js";
import { createInitialCluster } from "./clusterState.js";
import { questions } from "../data/questions.js";
import { gradeQuestion } from "../scoring/grader.js";

const solutionCommands = {
  "storage-cache-pvc": [
    `cat <<EOF > /home/candidate/manifests/cache-pvc
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: cache-pvc
  namespace: storage
spec:
  storageClassName: fast
  resources:
    requests:
      storage: 2Gi
EOF`,
    "kubectl apply -f /home/candidate/manifests/cache-pvc",
  ],
  "storage-log-consumer": ["kubectl apply -f /home/candidate/manifests/log-consumer"],
  "troubleshoot-billing-image": [
    "kubectl apply -f /home/candidate/manifests/billing-broken",
    "kubectl set image deployment/billing-api app=nginx:1.27 -n troubleshooting",
  ],
  "troubleshoot-worker-notready": [
    "kubectl cordon worker-2",
    "echo Ready changed to False > /home/candidate/reports/worker-2",
  ],
  "troubleshoot-service-selector": [
    `cat <<EOF > /home/candidate/manifests/metrics-stack
apiVersion: apps/v1
kind: Deployment
metadata:
  name: metrics-api
  namespace: troubleshooting
  labels:
    app: metrics-api
spec:
  replicas: 1
  selector:
    matchLabels:
      app: metrics-api
  template:
    metadata:
      labels:
        app: metrics-api
    spec:
      containers:
      - name: app
        image: nginx:1.27
---
apiVersion: v1
kind: Service
metadata:
  name: metrics-svc
  namespace: troubleshooting
spec:
  selector:
    app: metrics-api
  ports:
  - port: 80
    targetPort: 8080
  type: ClusterIP
EOF`,
    "kubectl apply -f /home/candidate/manifests/metrics-stack",
  ],
  "troubleshoot-scale-reporting": [
    "kubectl apply -f /home/candidate/manifests/reporting-load",
    "kubectl scale deployment/reporting-job --replicas=1 -n troubleshooting",
  ],
  "troubleshoot-configmap-missing": [
    "kubectl apply -f /home/candidate/manifests/orders-worker",
    "kubectl create configmap orders-config --from-literal=MODE=stable --from-literal=RETRIES=3 -n troubleshooting",
  ],
  "workloads-blue-deploy": ["kubectl create deployment blue-web --image=nginx:1.27 --replicas=3 -n workloads"],
  "workloads-feature-config": [
    "kubectl create configmap feature-flags --from-literal=ENABLE_SEARCH=true -n workloads",
    "kubectl create deployment search-api --image=nginx:1.27 --replicas=2 -n workloads",
  ],
  "workloads-debug-pod": ["kubectl run debug-shell --image=busybox:1.36 -n workloads"],
  "cluster-platform-namespace": [
    "kubectl create namespace platform",
    "kubectl create deployment platform-controller --image=nginx:1.27 -n platform",
  ],
  "cluster-rbac-reader": ["kubectl apply -f /home/candidate/manifests/pod-reader-rbac"],
  "cluster-drain-maintenance": [
    "kubectl drain worker-1",
    "echo drained > /home/candidate/reports/worker-1-maintenance",
  ],
  "cluster-static-pod-manifest": [
    `cat <<EOF > /etc/kubernetes/manifests/audit-proxy
apiVersion: v1
kind: Pod
metadata:
  name: audit-proxy
spec:
  containers:
  - name: audit-proxy
    image: nginx:1.27
EOF`,
  ],
  "network-frontend-service": [
    "kubectl apply -f /home/candidate/manifests/frontend-app",
    `cat <<EOF > /home/candidate/manifests/frontend-svc
apiVersion: v1
kind: Service
metadata:
  name: frontend-svc
  namespace: network
spec:
  selector:
    app: frontend
  ports:
  - port: 80
    targetPort: 8080
  type: ClusterIP
EOF`,
    "kubectl apply -f /home/candidate/manifests/frontend-svc",
  ],
  "network-shop-ingress": [
    "kubectl apply -f /home/candidate/manifests/shop-service",
    `cat <<EOF > /home/candidate/manifests/shop-ingress
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: shop-ingress
  namespace: network
spec:
  ingressClassName: nginx
  rules:
  - host: shop.local
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: shop-svc
            port:
              number: 80
EOF`,
    "kubectl apply -f /home/candidate/manifests/shop-ingress",
  ],
  "network-db-policy": ["kubectl apply -f /home/candidate/manifests/db-policy"],
};

describe("CKA virtual lab simulator", () => {
  it("runs basic shell and kubectl commands", () => {
    const session = createLabSession({ questions, initialCluster: createInitialCluster() });
    expect(session.runCommand("pwd").output).toBe("/home/candidate");
    expect(session.runCommand("kubectl get nodes").output).toContain("control-plane");
  });

  it("applies a deployment manifest and grades a matching task", () => {
    const question = {
      id: "test",
      title: "test",
      checks: [
        {
          id: "deploy",
          label: "deployment exists",
          path: "cluster.namespaces.workloads.deployments.web.replicas",
          equals: 2,
          detail: "replicas must be 2",
        },
      ],
    };
    const session = createLabSession({ questions: [question], initialCluster: createInitialCluster() });
    session.runCommand(`cat <<EOF > web.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web
  namespace: workloads
spec:
  replicas: 2
  template:
    spec:
      containers:
      - name: web
        image: nginx:1.27
EOF`);
    session.runCommand("kubectl apply -f web.yaml");
    expect(gradeQuestion(question, session.getSnapshot()).passed).toBe(true);
  });

  it("returns not found instead of creating missing namespaces during resource lookup", () => {
    const session = createLabSession({ questions, initialCluster: createInitialCluster() });

    const result = session.runCommand("kubectl get pods -n ghost");

    expect(result.output).toBe('Error from server (NotFound): namespaces "ghost" not found');
    expect(session.getSnapshot().cluster.namespaces.ghost).toBeUndefined();
  });

  it("rejects namespaced commands when the namespace does not exist", () => {
    const session = createLabSession({ questions, initialCluster: createInitialCluster() });

    const commands = [
      "kubectl describe pod web -n ghost",
      "kubectl create deployment web --image=nginx:1.27 -n ghost",
      "kubectl run debug --image=busybox:1.36 -n ghost",
      "kubectl delete pod web -n ghost",
      "kubectl scale deployment/web --replicas=2 -n ghost",
      "kubectl set image deployment/web app=nginx:1.27 -n ghost",
      "kubectl rollout status deployment/web -n ghost",
      "kubectl logs web -n ghost",
    ];

    for (const command of commands) {
      expect(session.runCommand(command).output, command).toBe(
        'Error from server (NotFound): namespaces "ghost" not found',
      );
    }
    expect(session.getSnapshot().cluster.namespaces.ghost).toBeUndefined();
  });

  it("rejects applying namespaced manifests to namespaces that do not exist", () => {
    const session = createLabSession({ questions, initialCluster: createInitialCluster() });

    session.runCommand(`cat <<EOF > ghost.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web
  namespace: ghost
spec:
  replicas: 1
  template:
    spec:
      containers:
      - name: web
        image: nginx:1.27
EOF`);
    const result = session.runCommand("kubectl apply -f ghost.yaml");

    expect(result.output).toBe('Error from server (NotFound): namespaces "ghost" not found');
    expect(session.getSnapshot().cluster.namespaces.ghost).toBeUndefined();
  });

  it("handles named get requests, missing resources, and unknown resource types", () => {
    const session = createLabSession({ questions, initialCluster: createInitialCluster() });

    expect(session.runCommand("kubectl get pod api-1 -n workloads").output).toContain("api-1");
    expect(session.runCommand("kubectl get pod/api-1 -n workloads").output).toContain("api-1");
    expect(session.runCommand("kubectl get pod/api-1 -A").output).toContain("workloads");
    expect(session.runCommand("kubectl get pod/api-1 -A").output).toContain("api-1");
    expect(session.runCommand("kubectl get pod missing -n workloads").output).toBe(
      'Error from server (NotFound): pods "missing" not found',
    );
    expect(session.runCommand("kubectl get widgets").output).toBe(
      'error: the server doesn\'t have a resource type "widgets"',
    );
  });

  it("returns not found for missing log targets instead of falling back to other pods", () => {
    const session = createLabSession({ questions, initialCluster: createInitialCluster() });

    expect(session.runCommand("kubectl logs deployment/api -n workloads").output).toContain("api server listening");
    expect(session.runCommand("kubectl logs missing -n workloads").output).toBe(
      'Error from server (NotFound): pods "missing" not found',
    );
    expect(session.runCommand("kubectl logs deployment/missing -n workloads").output).toBe(
      'Error from server (NotFound): deployments.apps "missing" not found',
    );
  });

  it("rejects duplicate create and run commands like the API server", () => {
    const session = createLabSession({ questions, initialCluster: createInitialCluster() });

    expect(session.runCommand("kubectl create namespace workloads").output).toBe(
      'Error from server (AlreadyExists): namespaces "workloads" already exists',
    );
    expect(session.runCommand("kubectl create deployment api --image=nginx:1.27 -n workloads").output).toBe(
      'Error from server (AlreadyExists): deployments.apps "api" already exists',
    );
    expect(session.runCommand("kubectl run api-1 --image=busybox:1.36 -n workloads").output).toBe(
      'Error from server (AlreadyExists): pods "api-1" already exists',
    );
  });

  it("rejects invalid apply documents instead of accepting impossible resources", () => {
    const session = createLabSession({ questions, initialCluster: createInitialCluster() });

    session.runCommand(`cat <<EOF > invalid-kind.yaml
apiVersion: example.com/v1
kind: Widget
metadata:
  name: impossible
EOF`);
    expect(session.runCommand("kubectl apply -f invalid-kind.yaml").output).toBe(
      'error: resource mapping not found for name: "impossible" kind: "Widget"',
    );

    session.runCommand(`cat <<EOF > missing-name.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  namespace: default
EOF`);
    expect(session.runCommand("kubectl apply -f missing-name.yaml").output).toBe(
      "error: resource name may not be empty",
    );
  });

  it("validates scale, set image, rollout status, context, and top node targets", () => {
    const session = createLabSession({ questions, initialCluster: createInitialCluster() });

    expect(session.runCommand("kubectl scale pod/api-1 --replicas=2 -n workloads").output).toBe(
      'error: cannot scale resource "pod/api-1"',
    );
    expect(session.runCommand("kubectl scale deployment/api -n workloads").output).toBe(
      "error: required flag(s) \"replicas\" not set",
    );
    expect(session.runCommand("kubectl set image deployment/api sidecar=nginx:1.27 -n workloads").output).toBe(
      'error: unable to find container named "sidecar"',
    );
    session.runCommand("kubectl apply -f /home/candidate/manifests/billing-broken");
    expect(session.runCommand("kubectl rollout status deployment/billing-api -n troubleshooting").output).toContain(
      "waiting for deployment",
    );
    expect(session.runCommand("kubectl config use-context missing@sim-cluster").output).toBe(
      'error: no context exists with the name: "missing@sim-cluster"',
    );
    expect(session.runCommand("kubectl top nodes worker-1").output).toContain("worker-1");
    expect(session.runCommand("kubectl top nodes missing-node").output).toBe(
      'Error from server (NotFound): nodes "missing-node" not found',
    );
  });

  it("removes owned pods when deleting a deployment", () => {
    const session = createLabSession({ questions, initialCluster: createInitialCluster() });

    expect(session.runCommand("kubectl delete deployment/api -n workloads").output).toBe("deployment/api deleted");
    expect(session.getSnapshot().cluster.namespaces.workloads.pods["api-1"]).toBeUndefined();
    expect(session.getSnapshot().cluster.namespaces.workloads.pods["api-2"]).toBeUndefined();
  });

  it("rejects create and run commands with missing names or invalid replicas", () => {
    const session = createLabSession({ questions, initialCluster: createInitialCluster() });

    expect(session.runCommand("kubectl create namespace").output).toBe("error: name is required");
    expect(session.runCommand("kubectl create namespace -n workloads").output).toBe("error: name is required");
    expect(session.runCommand("kubectl create deployment --image=nginx:1.27 -n workloads").output).toBe(
      "error: name is required",
    );
    expect(session.runCommand("kubectl run --image=busybox:1.36 -n workloads").output).toBe("error: name is required");
    expect(session.runCommand("kubectl create deployment bad --image=nginx:1.27 --replicas=abc -n workloads").output).toBe(
      'error: invalid replicas value "abc"',
    );
    expect(session.getSnapshot().cluster.namespaces.workloads.deployments.bad).toBeUndefined();
  });

  it("rejects apply documents that are missing apiVersion or contain invalid replicas", () => {
    const session = createLabSession({ questions, initialCluster: createInitialCluster() });

    session.runCommand(`cat <<EOF > no-version.yaml
kind: ConfigMap
metadata:
  name: no-version
EOF`);
    expect(session.runCommand("kubectl apply -f no-version.yaml").output).toBe("error: apiVersion may not be empty");

    session.runCommand(`cat <<EOF > bad-replicas.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: bad-replicas
  namespace: workloads
spec:
  replicas: abc
  template:
    spec:
      containers:
      - name: app
        image: nginx:1.27
EOF`);
    expect(session.runCommand("kubectl apply -f bad-replicas.yaml").output).toBe(
      'error: invalid replicas value "abc"',
    );
    expect(session.getSnapshot().cluster.namespaces.workloads.deployments["bad-replicas"]).toBeUndefined();
  });

  it("validates rollout subcommands and named namespace get", () => {
    const session = createLabSession({ questions, initialCluster: createInitialCluster() });

    expect(session.runCommand("kubectl rollout history deployment/api -n workloads").output).toBe(
      "error: only rollout status is simulated",
    );
    expect(session.runCommand("kubectl rollout restart deployment/api -n workloads").output).toBe(
      "error: only rollout status is simulated",
    );
    expect(session.runCommand("kubectl get namespace workloads").output).toContain("workloads");
    expect(session.runCommand("kubectl get namespace ghost").output).toBe(
      'Error from server (NotFound): namespaces "ghost" not found',
    );
  });

  it("rejects empty images, empty replicas, invalid service ports, and apiVersion-kind mismatches", () => {
    const session = createLabSession({ questions, initialCluster: createInitialCluster() });

    expect(session.runCommand("kubectl create deployment empty-img --image= -n workloads").output).toBe(
      "error: image must not be empty",
    );
    expect(session.runCommand("kubectl run empty-pod --image= -n workloads").output).toBe(
      "error: image must not be empty",
    );
    expect(session.runCommand("kubectl set image deployment/api api= -n workloads").output).toBe(
      "error: image must not be empty",
    );
    expect(session.runCommand("kubectl scale deployment/api --replicas= -n workloads").output).toBe(
      'error: invalid replicas value ""',
    );
    expect(session.runCommand("kubectl create deployment empty-replicas --image=nginx:1.27 --replicas= -n workloads").output).toBe(
      'error: invalid replicas value ""',
    );
    expect(session.runCommand("kubectl create service clusterip bad-svc --tcp=abc -n workloads").output).toBe(
      'error: invalid tcp value "abc"',
    );

    session.runCommand(`cat <<EOF > wrong-version.yaml
apiVersion: v1
kind: Deployment
metadata:
  name: wrong-version
  namespace: workloads
spec:
  replicas: 1
  template:
    spec:
      containers:
      - name: app
        image: nginx:1.27
EOF`);
    expect(session.runCommand("kubectl apply -f wrong-version.yaml").output).toBe(
      'error: no matches for kind "Deployment" in version "v1"',
    );
    const snapshot = session.getSnapshot();
    expect(snapshot.cluster.namespaces.workloads.deployments["empty-img"]).toBeUndefined();
    expect(snapshot.cluster.namespaces.workloads.pods["empty-pod"]).toBeUndefined();
    expect(snapshot.cluster.namespaces.workloads.deployments["empty-replicas"]).toBeUndefined();
    expect(snapshot.cluster.namespaces.workloads.services["bad-svc"]).toBeUndefined();
    expect(snapshot.cluster.namespaces.workloads.deployments["wrong-version"]).toBeUndefined();
  });

  it("honors kubectl namespace flags and rejects non-integer numeric strings", () => {
    const session = createLabSession({ questions, initialCluster: createInitialCluster() });

    session.runCommand(`cat <<EOF > no-ns-deploy.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: apply-flag-leak
spec:
  replicas: 1
  template:
    spec:
      containers:
      - name: app
        image: nginx:1.27
EOF`);

    expect(session.runCommand("kubectl apply -f no-ns-deploy.yaml -n ghost").output).toBe(
      'Error from server (NotFound): namespaces "ghost" not found',
    );
    expect(session.getSnapshot().cluster.namespaces.default.deployments["apply-flag-leak"]).toBeUndefined();
    expect(session.getSnapshot().cluster.namespaces.ghost).toBeUndefined();

    expect(session.runCommand("kubectl apply -f no-ns-deploy.yaml -n workloads").output).toBe(
      "deployment.apps/apply-flag-leak configured",
    );
    expect(session.getSnapshot().cluster.namespaces.workloads.deployments["apply-flag-leak"]).toBeDefined();
    expect(session.getSnapshot().cluster.namespaces.default.deployments["apply-flag-leak"]).toBeUndefined();

    expect(session.runCommand("kubectl run compact-leak --image=busybox:1.36 -nghost").output).toBe(
      'Error from server (NotFound): namespaces "ghost" not found',
    );
    expect(session.runCommand("kubectl run compact-ok --image=busybox:1.36 -nworkloads").output).toBe(
      "pod/compact-ok created",
    );
    expect(session.getSnapshot().cluster.namespaces.default.pods["compact-leak"]).toBeUndefined();
    expect(session.getSnapshot().cluster.namespaces.workloads.pods["compact-ok"]).toBeDefined();

    expect(session.runCommand("kubectl scale deployment/api --replicas=1.0 -n workloads").output).toBe(
      'error: invalid replicas value "1.0"',
    );
    expect(session.getSnapshot().cluster.namespaces.workloads.deployments.api.replicas).toBe(2);

    expect(session.runCommand("kubectl create service clusterip bad-port --tcp=80.0:8080 -n workloads").output).toBe(
      'error: invalid tcp value "80.0:8080"',
    );
    expect(session.getSnapshot().cluster.namespaces.workloads.services["bad-port"]).toBeUndefined();
  });

  it("rejects malformed resource targets and extra create names without mutating state", () => {
    const session = createLabSession({ questions, initialCluster: createInitialCluster() });

    expect(session.runCommand("kubectl delete deployment/api/extra -n workloads").output).toBe(
      "error: arguments in resource/name form may not have more than one slash",
    );
    expect(session.getSnapshot().cluster.namespaces.workloads.deployments.api).toBeDefined();
    expect(session.getSnapshot().cluster.namespaces.workloads.pods["api-1"]).toBeDefined();

    expect(session.runCommand("kubectl scale deployment/api/extra --replicas=1 -n workloads").output).toBe(
      "error: arguments in resource/name form may not have more than one slash",
    );
    expect(session.getSnapshot().cluster.namespaces.workloads.deployments.api.replicas).toBe(2);

    expect(session.runCommand("kubectl set image deployment/api/extra api=nginx:1.27 -n workloads").output).toBe(
      "error: arguments in resource/name form may not have more than one slash",
    );
    expect(session.getSnapshot().cluster.namespaces.workloads.deployments.api.image).toBe(
      "registry.k8s.io/e2e-test-images/agnhost:2.53",
    );

    expect(session.runCommand("kubectl create namespace stray extra").output).toBe(
      "error: exactly one NAME is required, got 2",
    );
    expect(session.runCommand("kubectl create deployment stray-deploy extra --image=nginx:1.27 -n workloads").output).toBe(
      "error: exactly one NAME is required, got 2",
    );
    expect(session.runCommand("kubectl create service clusterip stray-svc extra --tcp=80:80 -n workloads").output).toBe(
      "error: exactly one NAME is required, got 2",
    );
    expect(session.getSnapshot().cluster.namespaces.stray).toBeUndefined();
    expect(session.getSnapshot().cluster.namespaces.workloads.deployments["stray-deploy"]).toBeUndefined();
    expect(session.getSnapshot().cluster.namespaces.workloads.services["stray-svc"]).toBeUndefined();
  });

  it("rejects non-integer deployment replicas from apply manifests", () => {
    const session = createLabSession({ questions, initialCluster: createInitialCluster() });

    session.runCommand(`cat <<EOF > decimal-replicas.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: decimal-replicas
  namespace: workloads
spec:
  replicas: 1.0
  template:
    spec:
      containers:
      - name: app
        image: nginx:1.27
EOF`);

    expect(session.runCommand("kubectl apply -f decimal-replicas.yaml").output).toBe(
      'error: invalid replicas value "1.0"',
    );
    expect(session.getSnapshot().cluster.namespaces.workloads.deployments["decimal-replicas"]).toBeUndefined();
  });

  it("handles cluster-scoped describe and delete targets without crashing", () => {
    const session = createLabSession({ questions, initialCluster: createInitialCluster() });

    expect(session.runCommand("kubectl describe namespace workloads").output).toContain("Name: workloads");
    expect(session.runCommand("kubectl describe node worker-1").output).toContain("Name: worker-1");
    expect(session.runCommand("kubectl delete namespace ghost").output).toBe(
      'Error from server (NotFound): namespaces "ghost" not found',
    );
    expect(session.runCommand("kubectl create namespace temp").output).toBe("namespace/temp created");
    expect(session.runCommand("kubectl delete namespace temp").output).toBe("namespace/temp deleted");
    expect(session.getSnapshot().cluster.namespaces.temp).toBeUndefined();
  });

  it("edits and saves files through the simulated vim workflow", () => {
    const session = createLabSession({ questions, initialCluster: createInitialCluster() });
    const content = [
      "apiVersion: v1",
      "kind: ConfigMap",
      "metadata:",
      "  name: vim-created",
      "  namespace: workloads",
      "",
    ].join("\n");

    expect(session.runCommand("vim /home/candidate/manifests/vim-created.yaml").output).toContain("[New File]");
    expect(session.getSnapshot().editor).toMatchObject({
      path: "/home/candidate/manifests/vim-created.yaml",
      mode: "normal",
    });
    expect(session.runCommand("i").output).toContain("-- INSERT --");
    expect(session.runCommand(content).output).toContain("-- INSERT --");
    expect(session.runCommand("\u001b").output).toContain("-- NORMAL --");
    expect(session.runCommand(":wq").output).toContain("\"vim-created.yaml\" written");

    expect(session.getSnapshot().editor).toBeNull();
    expect(session.runCommand("cat /home/candidate/manifests/vim-created.yaml").output).toBe(content);
  });

  it("keeps unsaved vim changes isolated until write", () => {
    const session = createLabSession({ questions, initialCluster: createInitialCluster() });

    session.runCommand("echo original > /home/candidate/vim-discard.txt");
    session.runCommand("vim /home/candidate/vim-discard.txt");
    session.runCommand("i");
    session.runCommand("\nchanged");
    session.runCommand("Esc");

    expect(session.runCommand(":q").output).toContain("No write since last change");
    expect(session.getSnapshot().editor).toMatchObject({ mode: "normal" });
    expect(session.runCommand(":q!").output).toContain("aborted");
    expect(session.getSnapshot().editor).toBeNull();
    expect(session.runCommand("cat /home/candidate/vim-discard.txt").output).toBe("original\n");
  });

  it("replaces existing strings through vim substitution commands", () => {
    const session = createLabSession({ questions, initialCluster: createInitialCluster() });

    expect(session.runCommand("vim /home/candidate/manifests/billing-broken").output).toContain("\"billing-broken\"");
    expect(session.runCommand(":%s#registry.local/billing:broken#nginx:1.27#g").output).toContain(
      "1 substitution",
    );
    expect(session.runCommand(":wq").output).toContain("\"billing-broken\" written");

    const file = session.runCommand("cat /home/candidate/manifests/billing-broken").output;
    expect(file).toContain("image: nginx:1.27");
    expect(file).not.toContain("registry.local/billing:broken");

    expect(session.runCommand("kubectl apply -f /home/candidate/manifests/billing-broken").output).toBe(
      "deployment.apps/billing-api configured",
    );
    expect(session.getSnapshot().cluster.namespaces.troubleshooting.deployments["billing-api"].image).toBe(
      "nginx:1.27",
    );
  });

  it("keeps shell commands from looking runnable while vim is active", () => {
    const session = createLabSession({ questions, initialCluster: createInitialCluster() });

    session.runCommand("vim /home/candidate/manifests/billing-broken");

    expect(session.runCommand("kubectl get po").output).toBe("E492: Not an editor command: kubectl get po");
    expect(session.getSnapshot().editor).toMatchObject({ path: "/home/candidate/manifests/billing-broken" });
  });

  it("allows the UI to edit the live vim buffer before writing it", () => {
    const session = createLabSession({ questions, initialCluster: createInitialCluster() });

    session.runCommand("vim /home/candidate/manifests/billing-broken");
    session.runCommand("i");
    const edited = session
      .getSnapshot()
      .editor.buffer.replace("registry.local/billing:broken", "nginx:1.27");

    expect(session.updateEditorBuffer(edited).editor.dirty).toBe(true);
    session.runCommand("Esc");
    session.runCommand(":wq");

    expect(session.runCommand("cat /home/candidate/manifests/billing-broken").output).toContain(
      "image: nginx:1.27",
    );
  });

  it("supports force write-quit in vim", () => {
    const session = createLabSession({ questions, initialCluster: createInitialCluster() });

    session.runCommand("vim /home/candidate/manifests/billing-broken");
    session.runCommand(":%s#registry.local/billing:broken#nginx:1.27#g");

    expect(session.runCommand(":wq!").output).toContain("\"billing-broken\" written");
    expect(session.getSnapshot().editor).toBeNull();
    expect(session.runCommand("cat /home/candidate/manifests/billing-broken").output).toContain(
      "image: nginx:1.27",
    );
  });

  it("starts with the practice questions unsolved", () => {
    const session = createLabSession({ questions, initialCluster: createInitialCluster() });
    const solved = questions.filter((question) => gradeQuestion(question, session.getSnapshot()).passed);
    expect(solved).toEqual([]);
  });

  it("solves every practice question through representative terminal commands", () => {
    const session = createLabSession({ questions, initialCluster: createInitialCluster() });

    for (const question of questions) {
      expect(solutionCommands[question.id], `missing solution commands for ${question.id}`).toBeDefined();
      for (const command of solutionCommands[question.id]) {
        session.runCommand(command);
      }
      expect(gradeQuestion(question, session.getSnapshot()), question.id).toMatchObject({ passed: true, score: 100 });
    }
  });
});
