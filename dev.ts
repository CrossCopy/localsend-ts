import { HttpServer } from "./services/HttpServer";
import { LocalSendService } from "./services/LocalSendService";
import { MulticastClient } from "./services/MulticastClient";
import { DeviceType, Protocol } from "./services/types";

const service = new LocalSendService({
  alias: "Huakun",
  deviceModel: "Huawei",
  deviceType: DeviceType.Mobile,
  port: 1566,
  protocol: Protocol.Http,
});

service.startServer();
service.startDiscovery();
