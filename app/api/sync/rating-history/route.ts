import { NextResponse } from "next/server";
import { garage61Get } from "@/lib/garage61";
import { supabaseAdmin } from "@/lib/supabase-admin";

// See app/api/sync/incremental/route.ts's comment -- same reasoning, so the third leg of "Atualizar
// dados" can't be the one that silently times out either.
export const maxDuration = 300;

type RatingHistoryItem = {
  at: string;
  rating: number;
  ratingDisplayAs?: string;
};

type Rating = {
  category: string;
  type: string;
  rating: number;
  ratingDisplayAs?: string;
  history?: RatingHistoryItem[];
};

type Account = {
  platform: string;
  id: string;
  name?: string;
  ratings?: Rating[];
};

type AccountsResponse = {
  items: Account[];
};

export async function POST() {
  try {
    // ----------------------------------------
    // GARAGE61
    // ----------------------------------------

    const response =
      await garage61Get<AccountsResponse>(
        "/me/accounts",
        {
          ratingHistory: "true",
        }
      );

    const account =
      response.items.find(
        (item) =>
          item.platform === "iracing"
      );

    if (!account) {
      throw new Error(
        "Conta iRacing não encontrada"
      );
    }

    // ----------------------------------------
    // DRIVER
    // ----------------------------------------

    const {
      data: driver,
      error: driverError,
    } = await supabaseAdmin
      .from("drivers")
      .select("id")
      .eq(
        "platform_driver_id",
        account.id
      )
      .single();

    if (
      driverError ||
      !driver
    ) {
      throw new Error(
        "Driver não encontrado no Supabase"
      );
    }

    // ----------------------------------------
    // TRANSFORMAR HISTÓRICO
    // ----------------------------------------

    const rows: {
      driver_id: string;
      category: string;
      rating_type: string;
      recorded_at: string;
      rating: number;
      rating_display: string | null;
    }[] = [];

    for (
      const rating of
      account.ratings ?? []
    ) {
      for (
        const historyItem of
        rating.history ?? []
      ) {
        rows.push({
          driver_id:
            driver.id,

          category:
            rating.category,

          rating_type:
            rating.type,

          recorded_at:
            historyItem.at,

          rating:
            historyItem.rating,

          rating_display:
            historyItem.ratingDisplayAs ??
            null,
        });
      }
    }

    if (
      rows.length === 0
    ) {
      return NextResponse.json({
        status: "ok",
        recordsFound: 0,
        recordsSynced: 0,
      });
    }

    // ----------------------------------------
    // UPSERT EM LOTES
    // ----------------------------------------

    const CHUNK_SIZE = 500;

    let recordsSynced = 0;

    for (
      let i = 0;
      i < rows.length;
      i += CHUNK_SIZE
    ) {
      const chunk =
        rows.slice(
          i,
          i + CHUNK_SIZE
        );

      const {
        error:
          upsertError,
      } =
        await supabaseAdmin
          .from(
            "rating_history"
          )
          .upsert(
            chunk,
            {
              onConflict:
                "driver_id,category,rating_type,recorded_at",
            }
          );

      if (upsertError) {
        throw upsertError;
      }

      recordsSynced +=
        chunk.length;
    }

    // ----------------------------------------
    // RESULTADO
    // ----------------------------------------

    const categorySummary =
      rows.reduce<
        Record<string, number>
      >(
        (
          accumulator,
          row
        ) => {
          const key =
            `${row.category}:${row.rating_type}`;

          accumulator[key] =
            (accumulator[key] ??
              0) + 1;

          return accumulator;
        },
        {}
      );

    return NextResponse.json({
      status: "ok",

      driver:
        account.name ??
        account.id,

      recordsFound:
        rows.length,

      recordsSynced,

      categories:
        categorySummary,
    });
  } catch (error) {
    return NextResponse.json(
      {
        status: "error",

        message:
          error instanceof Error
            ? error.message
            : String(error),
      },
      {
        status: 500,
      }
    );
  }
}
