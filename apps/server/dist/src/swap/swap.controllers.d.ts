import { NextFunction, Request, Response } from "express";
export declare const swapQuoteController: (req: Request, res: Response, next: NextFunction) => Promise<void>;
export declare const swapTransactionController: (req: Request, res: Response, next: NextFunction) => Promise<void>;
export declare const testnetSwapTransactionController: (req: Request, res: Response, next: NextFunction) => Promise<void>;
export declare const tokenListController: (req: Request, res: Response, next: NextFunction) => Promise<void>;
export declare const tokenPriceController: (req: Request, res: Response, next: NextFunction) => Promise<void>;
export declare const tokenDetailsController: (req: Request, res: Response, next: NextFunction) => Promise<void>;
export declare const tokenListWithDetailsController: (req: Request, res: Response, next: NextFunction) => Promise<void>;
export declare const tokenSearchController: (req: Request, res: Response, next: NextFunction) => Promise<void>;
