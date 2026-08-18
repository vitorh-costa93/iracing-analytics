import { NextResponse } from "next/server";
import { garage61Get } from "@/lib/garage61";
import { supabaseAdmin } from "@/lib/supabase-admin";

type Garage61CarGroup = {
  id: number;
  name: string;
  platform: string;
  cars: number[];
};

type Garage61CarGroupsResponse = {
  items: Garage61CarGroup[];
  total: number;
};

export async function POST() {
  try {
    const response =
      await garage61Get<Garage61CarGroupsResponse>(
        "/car-groups"
      );

    const groups =
      response.items ?? [];

    let groupsSynced = 0;
    let membersSynced = 0;
    let carsNotFound = 0;

    for (const group of groups) {
      const {
        error: groupError,
      } = await supabaseAdmin
        .from("car_groups")
        .upsert(
          {
            id: group.id,
            name: group.name,
            platform: group.platform,
          },
          {
            onConflict: "id",
          }
        );

      if (groupError) {
        throw groupError;
      }

      groupsSynced++;

      // IDs em group.cars são platform_id do Garage61/iRacing,
      // NÃO o nosso cars.id interno.
      if (
        !group.cars ||
        group.cars.length === 0
      ) {
        continue;
      }

      const {
        data: localCars,
        error: carsError,
      } = await supabaseAdmin
        .from("cars")
        .select("id, platform_id")
        .eq("platform", group.platform)
        .in(
          "platform_id",
          group.cars
        );

      if (carsError) {
        throw carsError;
      }

      const foundPlatformIds =
        new Set(
          (localCars ?? []).map(
            (car) =>
              Number(car.platform_id)
          )
        );

      carsNotFound +=
        group.cars.filter(
          (platformId) =>
            !foundPlatformIds.has(
              Number(platformId)
            )
        ).length;

      const members =
        (localCars ?? []).map(
          (car) => ({
            car_group_id:
              group.id,

            car_id:
              car.id,
          })
        );

      if (
        members.length > 0
      ) {
        const {
          error:
            memberError,
        } =
          await supabaseAdmin
            .from(
              "car_group_members"
            )
            .upsert(
              members,
              {
                onConflict:
                  "car_group_id,car_id",
              }
            );

        if (memberError) {
          throw memberError;
        }

        membersSynced +=
          members.length;
      }
    }

    return NextResponse.json({
      status: "ok",

      groupsFound:
        groups.length,

      groupsSynced,

      membersSynced,

      carsNotFound,
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
