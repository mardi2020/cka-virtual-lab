export const examDomains = [
  { name: "Storage", weight: 10 },
  { name: "Troubleshooting", weight: 30 },
  { name: "Workloads & Scheduling", weight: 15 },
  { name: "Cluster Architecture, Installation & Configuration", weight: 25 },
  { name: "Services & Networking", weight: 20 },
];

export const questions = [
  {
    id: "storage-cache-pvc",
    title: "fast 스토리지 PVC 준비",
    domain: "Storage",
    prompt:
      "storage 네임스페이스에 fast StorageClass를 사용하는 PersistentVolumeClaim cache-pvc를 2Gi 크기로 생성하세요. 최종 매니페스트는 /home/candidate/manifests/cache-pvc에 남기고 클러스터에 적용해야 합니다.",
    hints: [
      "cat <<EOF > /home/candidate/manifests/cache-pvc 형식으로 PVC 매니페스트를 작성할 수 있습니다.",
      "spec.storageClassName은 fast, spec.resources.requests.storage는 2Gi가 되도록 하세요.",
      "kubectl apply -f /home/candidate/manifests/cache-pvc로 적용하세요.",
    ],
    startingFiles: {
      "/home/candidate/manifests/cache-pvc": `apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: cache-pvc
  namespace: storage
spec:
  storageClassName: TODO
  resources:
    requests:
      storage: TODO
`,
    },
    checks: [
      {
        id: "cache-pvc-bound",
        label: "cache-pvc가 Bound 상태입니다",
        path: "cluster.namespaces.storage.persistentVolumeClaims.cache-pvc.status",
        equals: "Bound",
        detail: "storage 네임스페이스에 cache-pvc를 적용해야 합니다.",
      },
      {
        id: "cache-pvc-class",
        label: "fast StorageClass를 사용합니다",
        path: "cluster.namespaces.storage.persistentVolumeClaims.cache-pvc.spec.storageClassName",
        equals: "fast",
        detail: "cache-pvc의 spec.storageClassName을 fast로 설정하세요.",
      },
      {
        id: "cache-pvc-size",
        label: "요청 용량이 2Gi입니다",
        path: "cluster.namespaces.storage.persistentVolumeClaims.cache-pvc.spec.resources.requests.storage",
        equals: "2Gi",
        detail: "cache-pvc의 requests.storage 값이 2Gi여야 합니다.",
      },
      {
        id: "cache-pvc-manifest",
        label: "PVC 매니페스트가 남아 있습니다",
        path: "files./home/candidate/manifests/cache-pvc.content",
        includes: "kind: PersistentVolumeClaim",
        detail: "/home/candidate/manifests/cache-pvc 파일에 PVC 매니페스트를 남겨야 합니다.",
      },
    ],
  },
  {
    id: "storage-log-consumer",
    title: "PVC를 사용하는 Pod 배치",
    domain: "Storage",
    prompt:
      "storage 네임스페이스에 log-pvc PVC를 1Gi로 만들고, busybox:1.36 이미지의 Pod log-writer가 해당 PVC를 사용하도록 배치하세요. 제공된 초안 파일 /home/candidate/manifests/log-consumer를 완성해 적용하면 됩니다.",
    hints: [
      "하나의 파일에 PVC와 Pod를 ---로 구분해 함께 둘 수 있습니다.",
      "Pod의 spec.volumes.persistentVolumeClaim.claimName 값이 log-pvc가 되도록 작성하세요.",
      "시뮬레이터에서는 apply 후 Pod가 Running이면 요구 조건을 만족합니다.",
    ],
    startingFiles: {
      "/home/candidate/manifests/log-consumer": `apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: log-pvc
  namespace: storage
spec:
  storageClassName: fast
  resources:
    requests:
      storage: 1Gi
---
apiVersion: v1
kind: Pod
metadata:
  name: log-writer
  namespace: storage
spec:
  containers:
  - name: writer
    image: busybox:1.36
  volumes:
  - name: log-data
    persistentVolumeClaim:
      claimName: log-pvc
`,
    },
    checks: [
      {
        id: "log-pvc-size",
        label: "log-pvc가 1Gi를 요청합니다",
        path: "cluster.namespaces.storage.persistentVolumeClaims.log-pvc.spec.resources.requests.storage",
        equals: "1Gi",
        detail: "storage 네임스페이스에 log-pvc PVC를 1Gi로 생성하세요.",
      },
      {
        id: "log-writer-running",
        label: "log-writer Pod가 Running입니다",
        path: "cluster.namespaces.storage.pods.log-writer.status",
        equals: "Running",
        detail: "log-writer Pod를 storage 네임스페이스에 적용해야 합니다.",
      },
      {
        id: "log-writer-claim",
        label: "Pod가 log-pvc를 참조합니다",
        path: "cluster.namespaces.storage.pods.log-writer.spec.persistentVolumeClaim.claimName",
        equals: "log-pvc",
        detail: "log-writer Pod의 volume claimName을 log-pvc로 설정하세요.",
      },
    ],
  },
  {
    id: "troubleshoot-billing-image",
    title: "ImagePullBackOff 배포 수정",
    domain: "Troubleshooting",
    prompt:
      "/home/candidate/manifests/billing-broken을 적용하면 troubleshooting 네임스페이스의 billing-api Deployment가 잘못된 이미지로 배포됩니다. 최종 상태에서 billing-api는 nginx:1.27 이미지를 사용하고 2개 Pod가 Running이어야 합니다.",
    hints: [
      "먼저 kubectl apply -f /home/candidate/manifests/billing-broken으로 문제 상태를 만들 수 있습니다.",
      "kubectl set image deployment/billing-api app=nginx:1.27 -n troubleshooting 명령을 사용할 수 있습니다.",
      "kubectl get pods -n troubleshooting로 상태 변화를 확인하세요.",
    ],
    startingFiles: {
      "/home/candidate/manifests/billing-broken": `apiVersion: apps/v1
kind: Deployment
metadata:
  name: billing-api
  namespace: troubleshooting
  labels:
    app: billing-api
spec:
  replicas: 2
  selector:
    matchLabels:
      app: billing-api
  template:
    metadata:
      labels:
        app: billing-api
    spec:
      containers:
      - name: app
        image: registry.local/billing:broken
`,
    },
    checks: [
      {
        id: "billing-image-fixed",
        label: "billing-api 이미지가 수정되었습니다",
        path: "cluster.namespaces.troubleshooting.deployments.billing-api.image",
        equals: "nginx:1.27",
        detail: "billing-api Deployment의 컨테이너 이미지를 nginx:1.27로 바꾸세요.",
      },
      {
        id: "billing-replicas",
        label: "billing-api 복제 수가 유지됩니다",
        path: "cluster.namespaces.troubleshooting.deployments.billing-api.replicas",
        equals: 2,
        detail: "billing-api Deployment는 replicas 2를 유지해야 합니다.",
      },
      {
        id: "billing-pod-running",
        label: "billing-api Pod가 Running입니다",
        path: "cluster.namespaces.troubleshooting.pods.billing-api-1.status",
        equals: "Running",
        detail: "이미지 수정 후 billing-api Pod가 Running 상태가 되어야 합니다.",
      },
    ],
  },
  {
    id: "troubleshoot-worker-notready",
    title: "NotReady 노드 격리와 증거 기록",
    domain: "Troubleshooting",
    prompt:
      "worker-2 노드가 NotReady 상태입니다. 새 Pod가 배치되지 않도록 worker-2를 스케줄 불가 상태로 만들고, kubelet 로그에서 확인한 Ready 변경 메시지를 /home/candidate/reports/worker-2 파일에 기록하세요.",
    hints: [
      "kubectl get nodes로 노드 상태를 확인하세요.",
      "kubectl cordon worker-2 또는 drain 명령으로 schedulable 상태를 바꿀 수 있습니다.",
      "journalctl -u kubelet 출력의 Ready changed to False 문구를 echo로 보고 파일에 남기세요.",
    ],
    checks: [
      {
        id: "worker-2-cordoned",
        label: "worker-2가 스케줄 불가입니다",
        path: "cluster.nodes.worker-2.schedulable",
        equals: false,
        detail: "worker-2를 cordon 또는 drain 처리해 schedulable 값을 false로 만드세요.",
      },
      {
        id: "worker-2-report",
        label: "노드 장애 증거가 파일에 기록되었습니다",
        path: "files./home/candidate/reports/worker-2.content",
        includes: "Ready changed to False",
        detail: "/home/candidate/reports/worker-2 파일에 Ready changed to False 문구를 포함하세요.",
      },
    ],
  },
  {
    id: "troubleshoot-service-selector",
    title: "Service selector 오타 수정",
    domain: "Troubleshooting",
    prompt:
      "/home/candidate/manifests/metrics-stack에는 metrics-api Deployment와 잘못된 selector를 가진 metrics-svc Service가 들어 있습니다. Service가 app=metrics-api Pod를 바라보도록 selector를 수정하고 targetPort 8080을 유지하세요.",
    hints: [
      "초안 파일을 apply한 뒤 kubectl describe service metrics-svc -n troubleshooting로 현재 selector를 볼 수 있습니다.",
      "Service의 spec.selector.app 값을 metrics-api로 바꾸면 됩니다.",
      "수정한 매니페스트를 다시 kubectl apply -f로 적용하세요.",
    ],
    startingFiles: {
      "/home/candidate/manifests/metrics-stack": `apiVersion: apps/v1
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
    app: wrong-label
  ports:
  - port: 80
    targetPort: 8080
  type: ClusterIP
`,
    },
    checks: [
      {
        id: "metrics-deploy-running",
        label: "metrics-api Deployment가 존재합니다",
        path: "cluster.namespaces.troubleshooting.deployments.metrics-api.status",
        equals: "Available",
        detail: "metrics-api Deployment를 troubleshooting 네임스페이스에 적용하세요.",
      },
      {
        id: "metrics-selector-fixed",
        label: "Service selector가 metrics-api입니다",
        path: "cluster.namespaces.troubleshooting.services.metrics-svc.spec.selector.app",
        equals: "metrics-api",
        detail: "metrics-svc의 spec.selector.app 값을 metrics-api로 수정하세요.",
      },
      {
        id: "metrics-target-port",
        label: "Service targetPort가 8080입니다",
        path: "cluster.namespaces.troubleshooting.services.metrics-svc.spec.targetPort",
        equals: 8080,
        detail: "metrics-svc의 targetPort 8080 설정을 유지하세요.",
      },
    ],
  },
  {
    id: "troubleshoot-scale-reporting",
    title: "과도한 부하 Deployment 축소",
    domain: "Troubleshooting",
    prompt:
      "/home/candidate/manifests/reporting-load는 troubleshooting 네임스페이스에 reporting-job Deployment를 4개 복제본으로 배치합니다. 노드 사용률을 확인한 뒤 최종 복제본 수를 1로 낮추세요.",
    hints: [
      "kubectl top nodes로 시뮬레이션된 노드 사용률을 확인할 수 있습니다.",
      "kubectl scale deployment/reporting-job --replicas=1 -n troubleshooting 명령을 사용할 수 있습니다.",
      "최종 Deployment의 replicas 값이 1이면 됩니다.",
    ],
    startingFiles: {
      "/home/candidate/manifests/reporting-load": `apiVersion: apps/v1
kind: Deployment
metadata:
  name: reporting-job
  namespace: troubleshooting
  labels:
    app: reporting-job
spec:
  replicas: 4
  selector:
    matchLabels:
      app: reporting-job
  template:
    metadata:
      labels:
        app: reporting-job
    spec:
      containers:
      - name: app
        image: nginx:1.27
`,
    },
    checks: [
      {
        id: "reporting-scaled",
        label: "reporting-job이 1개로 축소되었습니다",
        path: "cluster.namespaces.troubleshooting.deployments.reporting-job.replicas",
        equals: 1,
        detail: "reporting-job Deployment의 replicas를 1로 조정하세요.",
      },
      {
        id: "reporting-running",
        label: "축소 후 Pod가 Running입니다",
        path: "cluster.namespaces.troubleshooting.pods.reporting-job-1.status",
        equals: "Running",
        detail: "축소 후 남은 reporting-job Pod가 Running이어야 합니다.",
      },
    ],
  },
  {
    id: "troubleshoot-configmap-missing",
    title: "누락된 설정 ConfigMap 복구",
    domain: "Troubleshooting",
    prompt:
      "troubleshooting 네임스페이스의 orders-worker가 안정 모드 설정을 필요로 합니다. ConfigMap orders-config를 만들고 MODE=stable, RETRIES=3 값을 포함하세요. 제공된 Deployment 초안도 적용되어 있어야 합니다.",
    hints: [
      "kubectl create configmap orders-config --from-literal=MODE=stable --from-literal=RETRIES=3 -n troubleshooting 형식을 사용할 수 있습니다.",
      "Deployment 초안은 /home/candidate/manifests/orders-worker에 있습니다.",
      "ConfigMap 데이터 키 이름은 대문자 그대로 MODE와 RETRIES입니다.",
    ],
    startingFiles: {
      "/home/candidate/manifests/orders-worker": `apiVersion: apps/v1
kind: Deployment
metadata:
  name: orders-worker
  namespace: troubleshooting
  labels:
    app: orders-worker
spec:
  replicas: 1
  selector:
    matchLabels:
      app: orders-worker
  template:
    metadata:
      labels:
        app: orders-worker
    spec:
      containers:
      - name: worker
        image: nginx:1.27
`,
    },
    checks: [
      {
        id: "orders-worker-ready",
        label: "orders-worker Deployment가 적용되었습니다",
        path: "cluster.namespaces.troubleshooting.deployments.orders-worker.status",
        equals: "Available",
        detail: "orders-worker Deployment 초안을 troubleshooting 네임스페이스에 적용하세요.",
      },
      {
        id: "orders-mode",
        label: "MODE 값이 stable입니다",
        path: "cluster.namespaces.troubleshooting.configMaps.orders-config.data.MODE",
        equals: "stable",
        detail: "orders-config ConfigMap에 MODE=stable 값을 추가하세요.",
      },
      {
        id: "orders-retries",
        label: "RETRIES 값이 3입니다",
        path: "cluster.namespaces.troubleshooting.configMaps.orders-config.data.RETRIES",
        equals: "3",
        detail: "orders-config ConfigMap에 RETRIES=3 값을 추가하세요.",
      },
    ],
  },
  {
    id: "workloads-blue-deploy",
    title: "blue-web Deployment 확장",
    domain: "Workloads & Scheduling",
    prompt:
      "workloads 네임스페이스에 nginx:1.27 이미지를 사용하는 blue-web Deployment를 만들고 최소 3개 복제본으로 실행하세요.",
    hints: [
      "kubectl create deployment blue-web --image=nginx:1.27 --replicas=3 -n workloads를 사용할 수 있습니다.",
      "이미 Deployment를 만들었다면 kubectl scale deployment/blue-web --replicas=3 -n workloads를 사용하세요.",
      "채점은 replicas가 3 이상이고 이미지가 nginx:1.27인지 확인합니다.",
    ],
    checks: [
      {
        id: "blue-replicas",
        label: "blue-web 복제본이 3개 이상입니다",
        path: "cluster.namespaces.workloads.deployments.blue-web.replicas",
        gte: 3,
        detail: "blue-web Deployment의 replicas를 3 이상으로 설정하세요.",
      },
      {
        id: "blue-image",
        label: "blue-web 이미지가 nginx:1.27입니다",
        path: "cluster.namespaces.workloads.deployments.blue-web.image",
        equals: "nginx:1.27",
        detail: "blue-web Deployment의 이미지를 nginx:1.27로 설정하세요.",
      },
      {
        id: "blue-third-pod",
        label: "세 번째 Pod가 생성되었습니다",
        path: "cluster.namespaces.workloads.pods.blue-web-3.status",
        equals: "Running",
        detail: "blue-web-3 Pod가 Running 상태가 되도록 복제본을 늘리세요.",
      },
    ],
  },
  {
    id: "workloads-feature-config",
    title: "애플리케이션 설정과 배포",
    domain: "Workloads & Scheduling",
    prompt:
      "workloads 네임스페이스에 feature-flags ConfigMap을 만들고 ENABLE_SEARCH=true 값을 넣으세요. 이어서 nginx:1.27 이미지의 search-api Deployment를 2개 복제본으로 배포하세요.",
    hints: [
      "kubectl create configmap feature-flags --from-literal=ENABLE_SEARCH=true -n workloads를 사용할 수 있습니다.",
      "kubectl create deployment search-api --image=nginx:1.27 --replicas=2 -n workloads로 Deployment를 만들 수 있습니다.",
      "ConfigMap과 Deployment는 같은 workloads 네임스페이스에 있어야 합니다.",
    ],
    checks: [
      {
        id: "feature-flag",
        label: "ENABLE_SEARCH가 true입니다",
        path: "cluster.namespaces.workloads.configMaps.feature-flags.data.ENABLE_SEARCH",
        equals: "true",
        detail: "feature-flags ConfigMap에 ENABLE_SEARCH=true 값을 추가하세요.",
      },
      {
        id: "search-replicas",
        label: "search-api 복제본이 2개입니다",
        path: "cluster.namespaces.workloads.deployments.search-api.replicas",
        equals: 2,
        detail: "search-api Deployment의 replicas를 2로 설정하세요.",
      },
      {
        id: "search-image",
        label: "search-api 이미지가 nginx:1.27입니다",
        path: "cluster.namespaces.workloads.deployments.search-api.image",
        equals: "nginx:1.27",
        detail: "search-api Deployment의 이미지를 nginx:1.27로 설정하세요.",
      },
    ],
  },
  {
    id: "workloads-debug-pod",
    title: "임시 진단 Pod 실행",
    domain: "Workloads & Scheduling",
    prompt:
      "workloads 네임스페이스에 busybox:1.36 이미지를 사용하는 debug-shell Pod를 실행하세요. Pod 이름은 debug-shell이어야 하며 Running 상태여야 합니다.",
    hints: [
      "kubectl run debug-shell --image=busybox:1.36 -n workloads를 사용할 수 있습니다.",
      "kubectl get pods -n workloads로 상태를 확인하세요.",
      "run 명령으로 만든 Pod에는 run=debug-shell 레이블이 붙습니다.",
    ],
    checks: [
      {
        id: "debug-running",
        label: "debug-shell Pod가 Running입니다",
        path: "cluster.namespaces.workloads.pods.debug-shell.status",
        equals: "Running",
        detail: "debug-shell Pod를 workloads 네임스페이스에서 실행하세요.",
      },
      {
        id: "debug-image",
        label: "debug-shell 이미지가 busybox:1.36입니다",
        path: "cluster.namespaces.workloads.pods.debug-shell.image",
        equals: "busybox:1.36",
        detail: "debug-shell Pod의 이미지를 busybox:1.36으로 설정하세요.",
      },
      {
        id: "debug-label",
        label: "run 레이블이 설정되었습니다",
        path: "cluster.namespaces.workloads.pods.debug-shell.labels.run",
        equals: "debug-shell",
        detail: "kubectl run으로 debug-shell Pod를 생성해 run 레이블을 유지하세요.",
      },
    ],
  },
  {
    id: "cluster-platform-namespace",
    title: "플랫폼 네임스페이스 부트스트랩",
    domain: "Cluster Architecture, Installation & Configuration",
    prompt:
      "신규 플랫폼 워크로드를 위해 platform 네임스페이스를 만들고, 그 안에 nginx:1.27 이미지의 platform-controller Deployment를 1개 복제본으로 배포하세요.",
    hints: [
      "kubectl create namespace platform으로 네임스페이스를 만들 수 있습니다.",
      "kubectl create deployment platform-controller --image=nginx:1.27 -n platform을 사용할 수 있습니다.",
      "Deployment가 platform 네임스페이스에 생성됐는지 확인하세요.",
    ],
    checks: [
      {
        id: "platform-namespace",
        label: "platform 네임스페이스가 있습니다",
        path: "cluster.namespaces.platform.name",
        equals: "platform",
        detail: "platform 네임스페이스를 생성하세요.",
      },
      {
        id: "platform-controller",
        label: "platform-controller가 배포되었습니다",
        path: "cluster.namespaces.platform.deployments.platform-controller.image",
        equals: "nginx:1.27",
        detail: "platform 네임스페이스에 platform-controller Deployment를 nginx:1.27 이미지로 생성하세요.",
      },
    ],
  },
  {
    id: "cluster-rbac-reader",
    title: "Pod 조회용 RBAC 구성",
    domain: "Cluster Architecture, Installation & Configuration",
    prompt:
      "security 네임스페이스에 pod-reader Role과 read-pods RoleBinding을 작성하세요. RoleBinding은 pod-reader Role을 참조해야 합니다. 제공된 /home/candidate/manifests/pod-reader-rbac 초안을 완성해 적용하세요.",
    hints: [
      "kind: Role과 kind: RoleBinding을 하나의 파일에 ---로 구분해 작성할 수 있습니다.",
      "RoleBinding의 spec.roleRef.name 값이 pod-reader인지 확인하세요.",
      "시뮬레이터는 RBAC 객체 존재와 roleRef 연결을 채점합니다.",
    ],
    startingFiles: {
      "/home/candidate/manifests/pod-reader-rbac": `apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: pod-reader
  namespace: security
rules:
- apiGroups: [""]
  resources: ["pods"]
  verbs: ["get", "list", "watch"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: read-pods
  namespace: security
subjects:
- kind: ServiceAccount
  name: default
  namespace: security
roleRef:
  kind: Role
  name: pod-reader
  apiGroup: rbac.authorization.k8s.io
`,
    },
    checks: [
      {
        id: "pod-reader-role",
        label: "pod-reader Role이 있습니다",
        path: "cluster.namespaces.security.roles.pod-reader.name",
        equals: "pod-reader",
        detail: "security 네임스페이스에 pod-reader Role을 생성하세요.",
      },
      {
        id: "pod-reader-resources",
        label: "Role이 pods 리소스를 대상으로 합니다",
        path: "cluster.namespaces.security.roles.pod-reader.spec.rules.resources",
        includes: "pods",
        detail: "pod-reader Role의 rules.resources에 pods를 포함하세요.",
      },
      {
        id: "read-pods-binding",
        label: "RoleBinding이 pod-reader를 참조합니다",
        path: "cluster.namespaces.security.roleBindings.read-pods.spec.roleRef.name",
        equals: "pod-reader",
        detail: "read-pods RoleBinding의 roleRef.name을 pod-reader로 설정하세요.",
      },
    ],
  },
  {
    id: "cluster-drain-maintenance",
    title: "worker-1 유지보수 준비",
    domain: "Cluster Architecture, Installation & Configuration",
    prompt:
      "worker-1 노드를 유지보수 대상으로 전환하세요. 최종 상태에서 worker-1은 스케줄 불가 상태여야 하며, /home/candidate/reports/worker-1-maintenance 파일에 drained 문구를 남기세요.",
    hints: [
      "kubectl drain worker-1 또는 kubectl cordon worker-1을 사용할 수 있습니다.",
      "보고 파일은 echo drained > /home/candidate/reports/worker-1-maintenance로 만들 수 있습니다.",
      "kubectl get nodes로 스케줄링 상태 변경을 확인하세요.",
    ],
    checks: [
      {
        id: "worker-1-unschedulable",
        label: "worker-1이 스케줄 불가입니다",
        path: "cluster.nodes.worker-1.schedulable",
        equals: false,
        detail: "worker-1을 drain 또는 cordon 처리하세요.",
      },
      {
        id: "worker-1-report",
        label: "유지보수 기록이 남아 있습니다",
        path: "files./home/candidate/reports/worker-1-maintenance.content",
        includes: "drained",
        detail: "/home/candidate/reports/worker-1-maintenance 파일에 drained 문구를 포함하세요.",
      },
    ],
  },
  {
    id: "cluster-static-pod-manifest",
    title: "Static Pod 매니페스트 작성",
    domain: "Cluster Architecture, Installation & Configuration",
    prompt:
      "컨트롤 플레인 노드의 정적 Pod 디렉터리에 audit-proxy 매니페스트를 작성하세요. 파일 경로는 /etc/kubernetes/manifests/audit-proxy이고, nginx:1.27 이미지를 사용하는 Pod 매니페스트여야 합니다.",
    hints: [
      "cat <<EOF > /etc/kubernetes/manifests/audit-proxy 방식으로 파일을 만들 수 있습니다.",
      "kind: Pod, metadata.name: audit-proxy, image: nginx:1.27을 포함하세요.",
      "이 문제는 파일 존재와 내용만 채점합니다.",
    ],
    checks: [
      {
        id: "audit-proxy-file",
        label: "정적 Pod 파일이 있습니다",
        path: "files./etc/kubernetes/manifests/audit-proxy.content",
        includes: "kind: Pod",
        detail: "/etc/kubernetes/manifests/audit-proxy 파일에 Pod 매니페스트를 작성하세요.",
      },
      {
        id: "audit-proxy-name",
        label: "Pod 이름이 audit-proxy입니다",
        path: "files./etc/kubernetes/manifests/audit-proxy.content",
        includes: "name: audit-proxy",
        detail: "정적 Pod 매니페스트에 metadata.name: audit-proxy를 포함하세요.",
      },
      {
        id: "audit-proxy-image",
        label: "nginx:1.27 이미지를 사용합니다",
        path: "files./etc/kubernetes/manifests/audit-proxy.content",
        includes: "image: nginx:1.27",
        detail: "정적 Pod 매니페스트의 컨테이너 이미지를 nginx:1.27로 설정하세요.",
      },
    ],
  },
  {
    id: "network-frontend-service",
    title: "frontend Service 노출",
    domain: "Services & Networking",
    prompt:
      "/home/candidate/manifests/frontend-app을 적용해 network 네임스페이스에 frontend Deployment를 배포하고, app=frontend Pod를 선택하는 ClusterIP Service frontend-svc를 targetPort 8080으로 생성하세요.",
    hints: [
      "frontend-app 초안에는 Deployment만 들어 있습니다.",
      "Service 매니페스트를 같은 파일에 추가하거나 별도 파일로 작성해 apply할 수 있습니다.",
      "Service selector app 값은 frontend여야 합니다.",
    ],
    startingFiles: {
      "/home/candidate/manifests/frontend-app": `apiVersion: apps/v1
kind: Deployment
metadata:
  name: frontend
  namespace: network
  labels:
    app: frontend
spec:
  replicas: 2
  selector:
    matchLabels:
      app: frontend
  template:
    metadata:
      labels:
        app: frontend
    spec:
      containers:
      - name: web
        image: nginx:1.27
`,
    },
    checks: [
      {
        id: "frontend-deployment",
        label: "frontend Deployment가 있습니다",
        path: "cluster.namespaces.network.deployments.frontend.replicas",
        equals: 2,
        detail: "frontend Deployment 초안을 network 네임스페이스에 적용하세요.",
      },
      {
        id: "frontend-service-selector",
        label: "Service selector가 frontend입니다",
        path: "cluster.namespaces.network.services.frontend-svc.spec.selector.app",
        equals: "frontend",
        detail: "frontend-svc의 spec.selector.app 값을 frontend로 설정하세요.",
      },
      {
        id: "frontend-service-target",
        label: "Service targetPort가 8080입니다",
        path: "cluster.namespaces.network.services.frontend-svc.spec.targetPort",
        equals: 8080,
        detail: "frontend-svc의 targetPort를 8080으로 설정하세요.",
      },
    ],
  },
  {
    id: "network-shop-ingress",
    title: "shop Ingress 라우팅",
    domain: "Services & Networking",
    prompt:
      "network 네임스페이스에 shop-svc Service를 적용하고, host shop.local을 shop-svc로 라우팅하는 Ingress shop-ingress를 작성하세요. IngressClass는 nginx로 설정하고 최종 Ingress 파일은 /home/candidate/manifests/shop-ingress에 남기세요.",
    hints: [
      "먼저 /home/candidate/manifests/shop-service를 apply하세요.",
      "Ingress 매니페스트에는 spec.ingressClassName: nginx와 host shop.local을 포함하세요.",
      "kubectl apply -f /home/candidate/manifests/shop-ingress로 Ingress를 적용하세요.",
    ],
    startingFiles: {
      "/home/candidate/manifests/shop-service": `apiVersion: v1
kind: Service
metadata:
  name: shop-svc
  namespace: network
spec:
  selector:
    app: frontend
  ports:
  - port: 80
    targetPort: 8080
  type: ClusterIP
`,
    },
    checks: [
      {
        id: "shop-service",
        label: "shop-svc Service가 있습니다",
        path: "cluster.namespaces.network.services.shop-svc.name",
        equals: "shop-svc",
        detail: "shop-svc Service를 network 네임스페이스에 적용하세요.",
      },
      {
        id: "shop-ingress-class",
        label: "IngressClass가 nginx입니다",
        path: "cluster.namespaces.network.ingresses.shop-ingress.spec.ingressClassName",
        equals: "nginx",
        detail: "shop-ingress의 spec.ingressClassName을 nginx로 설정하세요.",
      },
      {
        id: "shop-ingress-host-file",
        label: "Ingress 매니페스트에 shop.local이 있습니다",
        path: "files./home/candidate/manifests/shop-ingress.content",
        includes: "shop.local",
        detail: "/home/candidate/manifests/shop-ingress 파일에 host shop.local을 포함하세요.",
      },
    ],
  },
  {
    id: "network-db-policy",
    title: "DB 접근 NetworkPolicy",
    domain: "Services & Networking",
    prompt:
      "network 네임스페이스에서 app=db Pod를 보호하는 NetworkPolicy db-allow-frontend를 작성하세요. 정책 파일은 /home/candidate/manifests/db-policy에 남기고, frontend에서 오는 트래픽을 허용한다는 의미가 드러나야 합니다.",
    hints: [
      "kind: NetworkPolicy 매니페스트를 작성해 kubectl apply -f로 적용하세요.",
      "spec.podSelector.matchLabels.app 값은 db로 설정하세요.",
      "정책 파일 안에 frontend 레이블을 포함해 허용 대상을 명확히 남기세요.",
    ],
    startingFiles: {
      "/home/candidate/manifests/db-policy": `apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: db-allow-frontend
  namespace: network
spec:
  podSelector:
    matchLabels:
      app: db
  ingress:
  - from:
    - podSelector:
        matchLabels:
          app: frontend
`,
    },
    checks: [
      {
        id: "db-policy-exists",
        label: "db-allow-frontend 정책이 있습니다",
        path: "cluster.namespaces.network.networkPolicies.db-allow-frontend.name",
        equals: "db-allow-frontend",
        detail: "network 네임스페이스에 db-allow-frontend NetworkPolicy를 적용하세요.",
      },
      {
        id: "db-policy-target",
        label: "정책 대상이 app=db입니다",
        path: "cluster.namespaces.network.networkPolicies.db-allow-frontend.spec.podSelector.matchLabels.app",
        equals: "db",
        detail: "NetworkPolicy의 podSelector.matchLabels.app 값을 db로 설정하세요.",
      },
      {
        id: "db-policy-frontend",
        label: "정책 파일에 frontend 허용이 명시되었습니다",
        path: "files./home/candidate/manifests/db-policy.content",
        includes: "frontend",
        detail: "/home/candidate/manifests/db-policy 파일에 frontend 허용 조건을 포함하세요.",
      },
    ],
  },
];
