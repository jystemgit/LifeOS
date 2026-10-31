import Image from "next/image";
import logo from "../../public/AVlogo.jpeg";

export function BrandLogo() {
  return (
    <Image
      className="brand-logo"
      src={logo}
      alt=""
      width={48}
      height={46}
      sizes="48px"
    />
  );
}
