'use server';

import { revalidatePath } from 'next/cache';

import { currentUserId } from '@/lib/auth';
import { searchCatalogForPicker } from '@/lib/catalog';
import {
  addMyProduct,
  removeMyProduct,
  removeMyProductByIdentity,
  listMyProducts,
  type MyProduct,
  type MyProductIdentity,
} from '@/lib/my-products';
import type { CatalogPickerMatch } from '@/lib/catalog';

export type ActionResult<T = undefined> =
  | ({ ok: true } & (T extends undefined ? object : { data: T }))
  | { ok: false; error: string };

export async function searchCatalogForMyProducts(q: string): Promise<CatalogPickerMatch[]> {
  return searchCatalogForPicker(q, 8);
}

export async function addToMyProducts(
  identity: MyProductIdentity,
): Promise<ActionResult<{ product: MyProduct }>> {
  const userId = await currentUserId();
  if (!userId) return { ok: false, error: 'Log in to save products.' };

  const name = identity.name?.trim();
  if (!name) return { ok: false, error: 'Product name is required.' };

  try {
    const product = await addMyProduct(userId, {
      catalogProductId: identity.catalogProductId,
      brand: identity.brand,
      name,
    });
    revalidatePath('/dashboard');
    revalidatePath('/search');
    revalidatePath('/');
    if (product.catalogProductId) {
      revalidatePath(`/products/${product.catalogProductId}`);
    }
    return { ok: true, data: { product } };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
}

export async function removeFromMyProducts(id: string): Promise<ActionResult> {
  const userId = await currentUserId();
  if (!userId) return { ok: false, error: 'Log in to remove products.' };

  try {
    await removeMyProduct(userId, id);
    revalidatePath('/dashboard');
    revalidatePath('/search');
    revalidatePath('/');
    return { ok: true };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
}

export async function removeFromMyProductsByIdentity(
  identity: MyProductIdentity,
): Promise<ActionResult> {
  const userId = await currentUserId();
  if (!userId) return { ok: false, error: 'Log in to remove products.' };

  const name = identity.name?.trim();
  if (!name) return { ok: false, error: 'Product name is required.' };

  try {
    await removeMyProductByIdentity(userId, {
      catalogProductId: identity.catalogProductId,
      brand: identity.brand,
      name,
    });
    revalidatePath('/dashboard');
    revalidatePath('/search');
    revalidatePath('/');
    if (identity.catalogProductId) {
      revalidatePath(`/products/${identity.catalogProductId}`);
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
}

export async function loadMyProducts(): Promise<{
  products: MyProduct[];
  error: string | null;
}> {
  const userId = await currentUserId();
  if (!userId) return { products: [], error: null };

  try {
    return { products: await listMyProducts(userId), error: null };
  } catch (error) {
    return { products: [], error: (error as Error).message };
  }
}
