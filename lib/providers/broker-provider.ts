export type BrokerProvider = {
  name: string;
  readonly supportsLiveOrders: boolean;
};

export type PaperOrderRequest = {
  signalId: string;
  optionSymbol: string;
  quantity: number;
  entryPrice: string;
};

export type OrderExecutionProvider = {
  placeOrder(request: PaperOrderRequest): Promise<never>;
  modifyOrder(orderId: string): Promise<never>;
  cancelOrder(orderId: string): Promise<never>;
};

export class DisabledOrderExecutionProvider implements OrderExecutionProvider {
  async placeOrder(request: PaperOrderRequest): Promise<never> {
    void request;
    throw new Error("Live order execution disabled in V1.");
  }

  async modifyOrder(orderId: string): Promise<never> {
    void orderId;
    throw new Error("Live order execution disabled in V1.");
  }

  async cancelOrder(orderId: string): Promise<never> {
    void orderId;
    throw new Error("Live order execution disabled in V1.");
  }
}
