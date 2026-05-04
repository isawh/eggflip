import { getProductById, type ProductId } from './monetization';

export interface PurchaseResult {
  success: boolean;
  productId: ProductId;
  transactionId: string;
}

export const purchaseProduct = async (productId: ProductId): Promise<PurchaseResult> => {
  const product = getProductById(productId);

  if (!product) {
    throw new Error(`Unknown product: ${productId}`);
  }

  await new Promise((resolve) => window.setTimeout(resolve, 450));

  return {
    success: true,
    productId,
    transactionId: `mock-${productId}-${Date.now()}`,
  };
};
