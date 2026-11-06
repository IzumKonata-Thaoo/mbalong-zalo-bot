// zca-js 2.x publishes its declarations through a directory re-export that
// TypeScript NodeNext cannot resolve. Keep this narrow runtime-facing shim
// until the upstream package points `types` directly at dist/index.d.ts.
declare module "zca-js" {
  export const LoginQRCallbackEventType: {
    QRCodeGenerated: string;
    QRCodeExpired: string;
    QRCodeScanned: string;
    GotLoginInfo: string;
  };
  export const ThreadType: {User:0;Group:1};
  export class Zalo {
    constructor(options?:Record<string,unknown>);
    login(credentials:unknown):Promise<any>;
    loginQR(options?:Record<string,unknown>,callback?:(event:any)=>void|Promise<void>):Promise<any>;
  }
}
