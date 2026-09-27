// Haskell のゴールデンテスト(docs/complexity-analyzer-plan.md §7.7。簡易対応で確からしさは低で固定)。
// forM_ / mapM_ / replicateM と内包表記をループ、等式とガードを分岐、(x:xs) の再帰を1ずつ進む再帰として読む。
import { test } from "node:test";
import { check } from "./helpers.ts";
import type { Golden } from "./helpers.ts";

const CASES: Golden[] = [
  {
    id: "H1 forM_ [1..n] $ \\i -> do の二重ループと when",
    lang: "haskell",
    code: `
      import Control.Monad

      main :: IO ()
      main = do
        n <- readLn :: IO Int
        forM_ [1..n] $ \\i -> do
          forM_ [1..n] $ \\j -> do
            when (i + j == n) $ print (i, j)`,
    time: "O(N²)",
    space: "O(1)",
    conf: "low",
  },
  {
    id: "H2 map read . words <$> getLine・sort・foldl' と M.insertWith",
    lang: "haskell",
    code: `
      import qualified Data.Map.Strict as M
      import Data.List (sort, foldl')

      main :: IO ()
      main = do
        n <- readLn :: IO Int
        as <- map read . words <$> getLine :: IO [Int]
        let bs = sort as
            m = foldl' (\\acc x -> M.insertWith (+) x 1 acc) M.empty bs
        print (M.size m)`,
    time: "O(N log N)",
    space: "O(N)",
  },
  {
    id: "H3a fact n = n * fact (n - 1)",
    lang: "haskell",
    code: `
      fact :: Int -> Int
      fact 0 = 1
      fact n = n * fact (n - 1)

      main :: IO ()
      main = do
        n <- readLn
        print (fact n)`,
    time: "O(N)",
    space: "O(N)",
  },
  {
    id: "H3b go i acc のガードの再帰",
    lang: "haskell",
    code: `
      main :: IO ()
      main = do
        n <- readLn :: IO Int
        let go i acc
              | i > n = acc
              | otherwise = go (i + 1) (acc + i)
        print (go 1 0)`,
    time: "O(N)",
    space: "O(N)",
  },
  {
    id: "H3c 二分探索の再帰(where mid = …)",
    lang: "haskell",
    code: `
      bs :: Int -> Int -> Int
      bs lo hi
        | hi - lo <= 1 = lo
        | mid * mid <= 1000000 = bs mid hi
        | otherwise = bs lo mid
        where
          mid = (lo + hi) \`div\` 2

      main :: IO ()
      main = do
        n <- readLn :: IO Int
        print (bs 0 n)`,
    time: "O(log N)",
    space: "O(log N)",
  },
  {
    id: "H3d fib",
    lang: "haskell",
    code: `
      fib :: Int -> Int
      fib 0 = 0
      fib 1 = 1
      fib n = fib (n - 1) + fib (n - 2)

      main :: IO ()
      main = readLn >>= print . fib`,
    time: "O(2^N)",
    space: "O(N)",
  },
  {
    id: "H4 [n, m] <- … と内包表記の length",
    lang: "haskell",
    code: `
      main :: IO ()
      main = do
        [n, m] <- map read . words <$> getLine :: IO [Int]
        print $ length [() | i <- [1..n], j <- [1..m], (i + j) \`mod\` 3 == 0]`,
    time: "O(N·M)",
    space: "O(1)",
    conf: "low",
  },
  {
    id: "H6 nub と !!",
    lang: "haskell",
    code: `
      import Data.List (nub)

      main :: IO ()
      main = do
        n <- readLn :: IO Int
        as <- map read . words <$> getLine :: IO [Int]
        mapM_ print (nub as)
        forM_ [0 .. n - 1] $ \\i -> print (as !! i)`,
    time: "O(N²)",
    space: "O(N)",
  },
  {
    id: "H8 let lim = 1000 と三角の forM_",
    lang: "haskell",
    code: `
      import Control.Monad

      main :: IO ()
      main = do
        let lim = 1000
        forM_ [1..lim] $ \\i ->
          forM_ [1..i] $ \\j -> when (i == j) $ print i`,
    time: "O(10^6)",
    space: "O(1)",
  },
  {
    id: "H9 [i+1..n] と [n, n-1 .. 1]",
    lang: "haskell",
    code: `
      import Control.Monad

      main :: IO ()
      main = do
        n <- readLn :: IO Int
        forM_ [1..n] $ \\i -> forM_ [i+1..n] $ \\j -> print (i, j)
        forM_ [n, n-1 .. 1] print`,
    time: "O(N²)",
    space: "O(1)",
  },
  {
    id: "H11 where の loop と ----- の区切り",
    lang: "haskell",
    code: `
      main :: IO ()
      main = do
        n <- readLn :: IO Int
        loop n
        where
          loop 0 = return ()
          loop i = print i >> loop (i - 1)
      -----------------------------------------
`,
    time: "O(N)",
    space: "O(N)",
  },
  {
    id: "H12 zip [0..] as・(x:xs) の go・let … in・BlockArguments の forM_",
    lang: "haskell",
    code: `
      {-# LANGUAGE BangPatterns, BlockArguments #-}
      import Control.Monad
      import Data.List (sort)

      main :: IO ()
      main = do
        n <- readLn :: IO Int
        xs <- map read . words <$> getLine :: IO [Int]
        forM_ (zip [0..] xs) $ \\(i, a) -> when (a > i) $ print a
        let go !acc [] = acc
            go !acc (y:ys) = go (acc + y) ys
        print (go 0 xs)
        let ys = sort xs in print (head ys)
        forM_ [1..n] \\i -> do
          print i`,
    time: "O(N log N)",
    space: "O(N)",
  },
  {
    id: "H7 テンプレート(A+B)",
    lang: "haskell",
    code: `
      main :: IO ()
      main = do
          [a, b] <- map read . words <$> getContents
          print (a + b :: Int)`,
    time: "O(1)",
    space: "O(1)",
    conf: "low",
  },
];

for (const g of CASES) test(g.id, () => void check(g));
