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

    const groups = response.items ?? [];

    let groupsSynced = 0;
    let membersSynced = 0;
    let carsNotFound = 0;

    const missingCars: {
      group: string;
      garage61CarId: number;
    }[] = [];

    for (const group of groups) {
      // Grupo
      const { error: groupError } =
        await supabaseAdmin
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

      if (!group.cars?.length) {
        continue;
      }

      /*
       * IMPORTANTE:
       *
       * group.cars contém o ID do objeto
       * Garage61.
       *
       * Esse valor corresponde a cars.id
       * na nossa tabela, NÃO a platform_id.
       */
      const {
        data: localCars,
        error: carsError,
      } = await supabaseAdmin
        .from("cars")
        .select("id, name")
        .in("id", group.cars);

      if (carsError) {
        throw carsError;
      }

      const foundIds = new Set(
        (localCars ?? []).map(
          (car) => Number(car.id)
        )
      );

      for (
        const garage61CarId of group.cars
      ) {
        if (
          !foundIds.has(
            Number(garage61CarId)
          )
        ) {
          carsNotFound++;

          missingCars.push({
            group: group.name,
            garage61CarId,
          });
        }
      }

      const members =
        (localCars ?? []).map(
          (car) => ({
            car_group_id: group.id,
            car_id: car.id,
          })
        );

      if (members.length === 0) {
        continue;
      }

      const { error: memberError } =
        await supabaseAdmin
          .from("car_group_members")
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

    return NextResponse.json({
      status: "ok",

      groupsFound: groups.length,
      groupsSynced,

      membersSynced,
      carsNotFound,

      missingCars,
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
