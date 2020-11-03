const k8s = require('@kubernetes/client-node')

class WorkerStatusService {
  constructor() {

  }

  async getWorkerStatus() {
    const nameSpace = 'worker-refs-heads-master'
    const kc = kc.makeApiClient(k8s.CoreV1Api);
    k8sApi.listNamespacedPod(nameSpace).then((res) => {
      console.log("PRINTING!!!!!!!! ", res.body);
    });

  }
  // helm status worker-26063a1b16d57fc2d81e1a4cb24973a88ce681f2 -n worker-refs-heads-master
}

module.exports = WorkerStatusService;
