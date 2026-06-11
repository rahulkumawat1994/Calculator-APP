export type MoneyTransaction = {
  id: string;
  account: string;
  date: Date | null;
  dateRaw: string;
  num: string;
  transaction: string;
  memo: string;
  category: string;
  payment: number;
  deposit: number;
};

export type MoneyUploadMeta = {
  fileName: string;
  uploadedAt: number;
  rowCount: number;
};

export type MoneyDataset = {
  meta: MoneyUploadMeta;
  transactions: MoneyTransaction[];
};
