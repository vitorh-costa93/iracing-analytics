import { NextResponse } from "next/server";
import { garage61Get } from "@/lib/garage61";
import { supabaseAdmin } from "@/lib/supabase-admin";

type Garage61Account = {
  platform: string;
  id: string;
  name: string;
  ratings: {
    category: string;
    type: string;
    rating: number;
    ratingDisplayAs: string;
  }[];
};

type Garage61AccountsResponse = {
  items: Garage61Account[];
  total: number;
};

export async function POST() {
  try {
    const response =
      await garage61Get<Garage61AccountsResponse>("/me/accounts");

    const account = response.items.find(
      (item) => item.platform === "iracing"
    );

    if (!account) {
      throw new Error("Conta iRacing não encontrada no Garage61");
    }

    const { data: driver, error: driverError } = await supabaseAdmin
      .from("drivers")
      .upsert(
        {
          platform: account.platform,
          platform_driver_id: account.id,
          name: account.name,
          updated_at: new Date().toISOString(),
        },
        {
          onConflict: "platform_driver_id",
        }
      )
      .select()
      .single();

    if (driverError) {
      throw driverError;
    }

    const ratingRows = account.ratings.map((rating) => ({
      driver_id: driver.id,
      category: rating.category,
      rating_type: rating.type,
      rating: rating.rating,
      rating_display: rating.ratingDisplayAs,
      recorded_at: new Date().toISOString(),
    }));

    const { error: ratingsError } = await supabaseAdmin
      .from("ratings")
      .insert(ratingRows);

    if (ratingsError) {
      throw ratingsError;
    }

    return NextResponse.json({
      status: "ok",
      driver,
      ratingsInserted: ratingRows.length,
    });
  } catch (error) {
    return NextResponse.json(
      {
        status: "error",
        message:
          error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
