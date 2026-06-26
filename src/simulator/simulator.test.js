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
