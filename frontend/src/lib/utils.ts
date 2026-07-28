import { clsx, type ClassValue } from "clsx" // 条件合并 class
import { twMerge } from "tailwind-merge" // 合并冲突的 Tailwind class

/**
 * 合并 Tailwind CSS class 名
 * @description 先用 clsx 合并条件 class，再用 twMerge 解决 Tailwind class 冲突
 * @param inputs class 值列表（字符串、对象、数组）
 * @returns 合并后的 class 字符串
 * @example cn("px-2", isActive && "bg-blue-500", "px-4") → "bg-blue-500 px-4"
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs)) // clsx 合并 → twMerge 去重
}
