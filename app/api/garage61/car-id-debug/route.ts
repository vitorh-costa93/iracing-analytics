import { NextResponse } from "next/server";
import { garage61Get } from "@/lib/garage61";

export async function GET() {
  try {
    const cars: any = await garage61Get("/cars");
    const groups: any = await garage61Get("/car-groups");

    const carItems =
      cars?.items ??
      cars?.data?.items ??
      [];

    const groupItems =
      groups?.items ??
      groups?.data?.items ??
      [];

    const interestingGroups =
      groupItems.filter((group: any) =>
        [
          "GT3",
          "GTP",
          "Super Formula",
          "GT4",
        ].includes(group.name)
      );

    const result =
      interestingGroups.map(
        (group: any) => ({
          groupId: group.id,
          groupName: group.name,

          rawCarIds: group.cars,

          matchesById:
            group.cars.map(
              (carId: number) => {
                const car =
                  carItems.find(
                    (item: any) =>
                      Number(item.id) ===
                      Number(carId)
                  );

                return {
                  requestedId:
                    carId,

                  found:
                    car ?? null,
                };
              }
            ),

          matchesByPlatformId:
            group.cars.map(
              (carId: number) => {
                const car =
                  carItems.find(
                    (item: any) =>
                      Number(
                        item.platform_id ??
                        item.platformId
                      ) ===
                      Number(carId)
                  );

                return {
                  requestedId:
                    carId,

                  found:
                    car ?? null,
                };
              }
            ),
        })
      );

    return NextResponse.json({
      status: "ok",
      carCount:
        carItems.length,
      result,
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
